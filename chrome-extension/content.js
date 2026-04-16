const EXTENSION_STATE_ATTRIBUTE = 'data-devwell-extension-state';
const EXTENSION_AUTH_ATTRIBUTE = 'data-devwell-extension-auth';
const EXTENSION_COMMAND_ATTRIBUTE = 'data-devwell-extension-command';
const DEFAULT_STATE = {
  blinkCount: 0,
  currentBlinkRate: 0,
  sessionAvgBlinkRate: 0,
  blinksPerMinute: 0,
  fatigueScore: 0,
  fatigueLevel: 'Fresh',
  longClosureEvents: 0,
  eyesOpen: true,
  sessionDurationMinutes: 0,
  isRunning: false,
};
const DASHBOARD_PATHS = ['/dashboard'];
const ACTION_TIMEOUT_MS = 12000;

class DevWellContentScript {
  constructor() {
    this.sessionActive = false;
    this.sessionData = null;
    this.websiteAuth = { loggedIn: false, email: null };
    this.extensionEngine = 'website';
    this.widget = null;
    this.refs = {};
    this.lastSyncedState = '';
    this.pendingActionTimer = null;
    this.lastCommandHandledAt = 0;

    void this.init();
  }

  async init() {
    if (document.getElementById('devwell-widget')) return;

    void chrome.storage.local.set({ appBaseUrl: window.location.origin });
    this.injectWidget();
    this.makeDraggable(this.widget);
    this.observeWebsiteState();
    this.observeWebsiteCommands();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === 'sessionStateUpdate') {
        this.sessionActive = Boolean(message.sessionActive);
        this.sessionData = message.sessionData ?? null;
        this.updateWidget();
        sendResponse?.({ success: true });
        return;
      }

      if (message?.action === 'performNativeSessionAction') {
        void this.performNativeSessionAction(message.sessionAction)
          .then((success) => sendResponse?.({ success }))
          .catch((error) => {
            console.error('[DevWell Content] Failed to perform action:', error);
            sendResponse?.({ success: false });
          });
        return true;
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.sessionActive) {
        this.sessionActive = Boolean(changes.sessionActive.newValue);
      }

      if (changes.sessionData) {
        this.sessionData = changes.sessionData.newValue ?? null;
      }

      if (changes.pendingWebsiteAction) {
        this.schedulePendingActionCheck();
      }

      if (changes.websiteAuth) {
        this.websiteAuth = changes.websiteAuth.newValue ?? this.websiteAuth;
      }

      if (changes.extensionEngine) {
        this.extensionEngine = changes.extensionEngine.newValue ?? this.extensionEngine;
      }

      if (changes.sessionActive || changes.sessionData || changes.extensionEngine) {
        this.writeExtensionState();
        this.updateWidget();
      }
    });

    const result = await chrome.storage.local.get(['sessionActive', 'sessionData', 'extensionEngine']);
    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.extensionEngine = result.extensionEngine ?? this.extensionEngine;
    this.writeExtensionState();
    this.updateWidget();
    this.syncFromWebsiteState();
    this.syncWebsiteAuth();
    this.schedulePendingActionCheck();
  }

  observeWebsiteState() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === EXTENSION_STATE_ATTRIBUTE)) {
        this.syncFromWebsiteState();
      }

      if (mutations.some((mutation) => mutation.attributeName === EXTENSION_AUTH_ATTRIBUTE)) {
        this.syncWebsiteAuth();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [EXTENSION_STATE_ATTRIBUTE, EXTENSION_AUTH_ATTRIBUTE],
    });
  }

  observeWebsiteCommands() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === EXTENSION_COMMAND_ATTRIBUTE)) {
        this.handleWebsiteCommand();
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [EXTENSION_COMMAND_ATTRIBUTE],
    });
  }

  handleWebsiteCommand() {
    const raw = document.documentElement.getAttribute(EXTENSION_COMMAND_ATTRIBUTE);
    if (!raw) return;

    let command;
    try {
      command = JSON.parse(raw);
    } catch {
      return;
    }

    if (command?.type === 'stop') {
      chrome.runtime.sendMessage({ action: 'requestStopSession' }).catch(() => undefined);
    } else if (command?.type === 'ping') {
      this.writeExtensionState();
    }
  }

  syncFromWebsiteState() {
    const rawState = document.documentElement.getAttribute(EXTENSION_STATE_ATTRIBUTE);
    if (!rawState || rawState === this.lastSyncedState) return;

    try {
      const parsed = JSON.parse(rawState);
      if (parsed?.source === 'extension') {
        return;
      }
      const nextSessionActive = Boolean(parsed?.sessionActive);
      const nextSessionData = parsed?.sessionData ?? null;
      this.lastSyncedState = rawState;
      this.sessionActive = nextSessionActive;
      this.sessionData = nextSessionData;
      this.updateWidget();
      void chrome.storage.local.set({
        appBaseUrl: window.location.origin,
        sessionActive: nextSessionActive,
        sessionData: nextSessionData,
      });
    } catch (error) {
      console.error('[DevWell Content] Failed to parse website state:', error);
    }
  }

  writeExtensionState() {
    const sessionData = this.sessionData ?? DEFAULT_STATE;
    document.documentElement.setAttribute(
      EXTENSION_STATE_ATTRIBUTE,
      JSON.stringify({
        source: 'extension',
        engine: this.extensionEngine,
        sessionActive: this.sessionActive,
        sessionData,
      })
    );
  }

  syncWebsiteAuth() {
    const rawAuth = document.documentElement.getAttribute(EXTENSION_AUTH_ATTRIBUTE);
    let nextAuth = {
      loggedIn: false,
      email: null,
    };

    if (rawAuth) {
      try {
        const parsed = JSON.parse(rawAuth);
        nextAuth = {
          loggedIn: Boolean(parsed?.loggedIn),
          email: parsed?.email ?? null,
        };
      } catch (error) {
        console.error('[DevWell Content] Failed to parse website auth:', error);
      }
    }

    this.websiteAuth = nextAuth;

    if (!nextAuth.loggedIn) {
      this.sessionActive = false;
      this.sessionData = null;
      this.updateWidget();
      void chrome.storage.local.set({
        appBaseUrl: window.location.origin,
        websiteAuth: nextAuth,
        pendingWebsiteAction: null,
        sessionActive: false,
        sessionData: null,
      });
      return;
    }

    void chrome.storage.local.set({
      appBaseUrl: window.location.origin,
      websiteAuth: nextAuth,
    });
  }

  schedulePendingActionCheck() {
    if (this.pendingActionTimer) {
      clearTimeout(this.pendingActionTimer);
    }

    this.pendingActionTimer = setTimeout(() => {
      void this.processPendingWebsiteAction();
    }, 150);
  }

  async processPendingWebsiteAction() {
    if (!this.isDashboardPage()) return;

    const { pendingWebsiteAction } = await chrome.storage.local.get('pendingWebsiteAction');
    if (!pendingWebsiteAction?.type) return;

    const success = await this.performNativeSessionAction(pendingWebsiteAction.type);
    const isExpired = Date.now() - (pendingWebsiteAction.requestedAt || 0) > ACTION_TIMEOUT_MS;

    if (success || isExpired) {
      await chrome.storage.local.remove('pendingWebsiteAction');
    }
  }

  isDashboardPage() {
    return DASHBOARD_PATHS.some((path) => window.location.pathname.startsWith(path));
  }

  async performNativeSessionAction(sessionAction) {
    const targetLabel = sessionAction === 'endSession' ? 'End Session' : 'Start Session';
    const targetRunningState = sessionAction === 'startSession';
    const deadline = Date.now() + ACTION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      this.syncFromWebsiteState();

      if (sessionAction === 'startSession' && this.sessionActive) {
        return true;
      }

      if (sessionAction === 'endSession' && !this.sessionActive) {
        return true;
      }

      const button = this.findButtonByText(targetLabel);
      if (button && !button.disabled) {
        button.click();
        await this.wait(250);

        if (targetRunningState === this.sessionActive || sessionAction === 'endSession') {
          return true;
        }
      } else {
        await this.wait(250);
      }
    }

    return false;
  }

  findButtonByText(targetLabel) {
    return Array.from(document.querySelectorAll('button')).find((button) => {
      const text = button.textContent?.replace(/\s+/g, ' ').trim();
      return text === targetLabel;
    }) ?? null;
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  injectWidget() {
    this.widget = document.createElement('div');
    this.widget.id = 'devwell-widget';
    this.widget.innerHTML = `
      <div class="devwell-widget-header">
        <div class="devwell-widget-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>DevWell</span>
        </div>
        <div class="devwell-widget-status">
          <span class="devwell-status-dot"></span>
          <span class="devwell-status-text">Offline</span>
        </div>
      </div>
      <div class="devwell-widget-metrics">
        <div class="devwell-metric">
          <div class="devwell-metric-label">Time</div>
          <div class="devwell-metric-value" data-role="time">00:00</div>
        </div>
        <div class="devwell-metric">
          <div class="devwell-metric-label">Blinks</div>
          <div class="devwell-metric-value" data-role="blinks">0</div>
        </div>
        <div class="devwell-metric">
          <div class="devwell-metric-label">Fatigue</div>
          <div class="devwell-metric-value" data-role="fatigue">0</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.widget);

    this.refs.status = this.widget.querySelector('.devwell-widget-status');
    this.refs.statusText = this.widget.querySelector('.devwell-status-text');
    this.refs.time = this.widget.querySelector('[data-role="time"]');
    this.refs.blinks = this.widget.querySelector('[data-role="blinks"]');
    this.refs.fatigue = this.widget.querySelector('[data-role="fatigue"]');
  }

  updateWidget() {
    if (!this.widget) return;

    const duration = this.sessionData?.sessionDurationMinutes ?? 0;
    const blinkCount = this.sessionData?.blinkCount ?? 0;
    const fatigueScore = this.sessionData?.fatigueScore ?? 0;

    if (this.sessionActive || duration > 0) {
      this.refs.status?.classList.add('active');
      if (this.refs.statusText) {
        this.refs.statusText.textContent = 'Monitoring';
      }
    } else {
      this.refs.status?.classList.remove('active');
      if (this.refs.statusText) {
        this.refs.statusText.textContent = 'Offline';
      }
    }

    if (this.refs.time) {
      this.refs.time.textContent = this.formatDuration(duration);
    }

    if (this.refs.blinks) {
      this.refs.blinks.textContent = String(blinkCount);
    }

    if (this.refs.fatigue) {
      this.refs.fatigue.textContent = String(fatigueScore);
      this.refs.fatigue.classList.remove(
        'devwell-fatigue-low',
        'devwell-fatigue-moderate',
        'devwell-fatigue-high'
      );

      if (fatigueScore > 70) {
        this.refs.fatigue.classList.add('devwell-fatigue-high');
      } else if (fatigueScore > 40) {
        this.refs.fatigue.classList.add('devwell-fatigue-moderate');
      } else {
        this.refs.fatigue.classList.add('devwell-fatigue-low');
      }
    }
  }

  formatDuration(minutes) {
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  makeDraggable(element) {
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerMove = (event) => {
      const nextLeft = initialLeft + (event.clientX - startX);
      const nextTop = initialTop + (event.clientY - startY);

      element.style.left = `${nextLeft}px`;
      element.style.top = `${nextTop}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    element.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.closest('.devwell-widget-header')) return;

      startX = event.clientX;
      startY = event.clientY;

      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new DevWellContentScript();
  });
} else {
  new DevWellContentScript();
}
