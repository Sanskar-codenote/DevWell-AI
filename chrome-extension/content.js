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
    this.extensionAuth = { loggedIn: false, email: null };
    this.extensionEngine = 'website';
    this.lastSyncedState = '';
    this.pendingActionTimer = null;

    void this.init();
  }

  isRuntimeAvailable() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  safeRuntimeSendMessage(payload) {
    if (!this.isRuntimeAvailable()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(payload).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  safeStorageSet(payload) {
    if (!this.isRuntimeAvailable()) return Promise.resolve();
    try {
      return chrome.storage.local.set(payload).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  async safeStorageGet(keys) {
    if (!this.isRuntimeAvailable()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch {
      return {};
    }
  }

  safeStorageRemove(keys) {
    if (!this.isRuntimeAvailable()) return Promise.resolve();
    try {
      return chrome.storage.local.remove(keys).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  async init() {
    await this.safeStorageSet({ appBaseUrl: window.location.origin });
    this.observeWebsiteState();
    this.observeWebsiteCommands();

    if (this.isRuntimeAvailable()) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === 'sessionStateUpdate') {
        this.sessionActive = Boolean(message.sessionActive);
        this.sessionData = message.sessionData ?? null;
        this.writeExtensionState(); // Update DOM attribute so website can see the new metrics
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

      if (message?.action === 'syncSettings') {
        // Forward the message to the website page
        window.postMessage({
          type: 'DEVWELL_SETTINGS_SYNC',
          settings: message.settings
        }, window.origin);
        sendResponse?.({ success: true });
        return;
      }
    });
    }

    if (this.isRuntimeAvailable()) {
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

      if (changes.extensionAuth) {
        const auth = changes.extensionAuth.newValue;
        this.extensionAuth = {
          loggedIn: Boolean(auth?.token),
          email: auth?.email ?? null,
        };
      }

      if (changes.extensionEngine) {
        this.extensionEngine = changes.extensionEngine.newValue ?? this.extensionEngine;
      }

      if (changes.sessionActive || changes.sessionData || changes.extensionEngine || changes.extensionAuth) {
        this.writeExtensionState();
      }
    });
    }

    const result = await this.safeStorageGet(['sessionActive', 'sessionData', 'extensionEngine', 'extensionAuth']);
    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.extensionEngine = result.extensionEngine ?? this.extensionEngine;
    this.extensionAuth = {
      loggedIn: Boolean(result.extensionAuth?.token),
      email: result.extensionAuth?.email ?? null,
    };
    this.writeExtensionState();
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
      void this.safeRuntimeSendMessage({ action: 'requestStopSession' });
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
      void this.safeStorageSet({
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
        extensionInstalled: true,
        engine: this.extensionEngine,
        sessionActive: this.sessionActive,
        sessionData,
        extensionAuth: this.extensionAuth,
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
      void this.safeStorageSet({
        websiteAuth: nextAuth,
        pendingWebsiteAction: null,
        sessionActive: false,
        sessionData: null,
      });
      return;
    }

    void this.safeStorageSet({
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

    const { pendingWebsiteAction } = await this.safeStorageGet('pendingWebsiteAction');
    if (!pendingWebsiteAction?.type) return;

    const success = await this.performNativeSessionAction(pendingWebsiteAction.type);
    const isExpired = Date.now() - (pendingWebsiteAction.requestedAt || 0) > ACTION_TIMEOUT_MS;

    if (success || isExpired) {
      await this.safeStorageRemove('pendingWebsiteAction');
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new DevWellContentScript();
  });
} else {
  new DevWellContentScript();
}
