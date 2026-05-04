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

class DevWellContentScript {
  constructor() {
    this.sessionActive = false;
    this.sessionData = null;
    this.websiteAuth = { loggedIn: false, email: null };
    this.extensionAuth = { loggedIn: false, email: null };
    this.extensionEngine = 'website';
    this.lastSyncedState = '';

    void this.init();
  }

  isRuntimeAvailable() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
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

  async init() {
    // 1. Basic initialization
    this.observeWebsiteState();
    this.observeWebsiteCommands();
    
    try {
      await this.safeStorageSet({ appBaseUrl: window.location.origin });
    } catch (e) {}

    // 2. Listen for messages from background
    if (this.isRuntimeAvailable()) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.action === 'sessionStateUpdate') {
          this.sessionActive = Boolean(message.sessionActive);
          this.sessionData = message.sessionData ?? null;
          this.writeExtensionState();
          sendResponse?.({ success: true });
        } else if (message?.action === 'syncSettings') {
          window.postMessage({ type: 'DEVWELL_SETTINGS_SYNC', settings: message.settings }, window.origin);
          sendResponse?.({ success: true });
        }
      });
    }

    // 3. Listen for storage changes
    if (this.isRuntimeAvailable()) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes.sessionActive) this.sessionActive = Boolean(changes.sessionActive.newValue);
        if (changes.sessionData) this.sessionData = changes.sessionData.newValue ?? null;
        if (changes.websiteAuth) this.websiteAuth = changes.websiteAuth.newValue ?? this.websiteAuth;
        if (changes.extensionEngine) this.extensionEngine = changes.extensionEngine.newValue ?? this.extensionEngine;
        
        if (changes.extensionAuth) {
          const auth = changes.extensionAuth.newValue;
          this.extensionAuth = { loggedIn: Boolean(auth?.token), email: auth?.email ?? null };
        }

        if (changes.sessionActive || changes.sessionData || changes.extensionEngine || changes.extensionAuth) {
          this.writeExtensionState();
        }
      });
    }

    // 4. Hydrate initial state
    const result = await this.safeStorageGet(['sessionActive', 'sessionData', 'extensionEngine', 'extensionAuth']);
    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.extensionEngine = result.extensionEngine ?? 'website';
    this.extensionAuth = {
      loggedIn: Boolean(result.extensionAuth?.token),
      email: result.extensionAuth?.email ?? null,
    };
    
    // 5. Final sync
    this.writeExtensionState();
    this.syncFromWebsiteState();
    this.syncWebsiteAuth();
  }

  observeWebsiteState() {
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === EXTENSION_STATE_ATTRIBUTE)) {
        this.syncFromWebsiteState();
      }
      if (mutations.some((m) => m.attributeName === EXTENSION_AUTH_ATTRIBUTE)) {
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
      if (mutations.some((m) => m.attributeName === EXTENSION_COMMAND_ATTRIBUTE)) {
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

    document.documentElement.removeAttribute(EXTENSION_COMMAND_ATTRIBUTE);

    let command;
    try {
      command = JSON.parse(raw);
    } catch { return; }

    if (command?.type === 'stop') {
      void this.safeRuntimeSendMessage({ action: 'requestStopSession' });
    } else if (command?.type === 'start') {
      void this.safeRuntimeSendMessage({ action: 'requestStartSession' });
    } else if (command?.type === 'pause') {
      void this.safeRuntimeSendMessage({ action: 'requestPauseSession' });
    } else if (command?.type === 'resume') {
      void this.safeRuntimeSendMessage({ action: 'requestResumeSession' });
    } else if (command?.type === 'syncSettings') {
      void this.safeRuntimeSendMessage({ action: 'syncWebsiteSettings', settings: command.settings });
    } else if (command?.type === 'ping') {
      this.writeExtensionState();
    }
  }

  syncFromWebsiteState() {
    const rawState = document.documentElement.getAttribute(EXTENSION_STATE_ATTRIBUTE);
    if (!rawState || rawState === this.lastSyncedState) return;

    try {
      const parsed = JSON.parse(rawState);
      if (parsed?.source === 'extension') return;
      
      this.lastSyncedState = rawState;
      this.sessionActive = Boolean(parsed?.sessionActive);
      this.sessionData = parsed?.sessionData ?? null;
      void this.safeStorageSet({
        sessionActive: this.sessionActive,
        sessionData: this.sessionData,
      });
    } catch (e) { console.error('[DevWell Content] Parse error:', e); }
  }

  syncWebsiteAuth() {
    const rawAuth = document.documentElement.getAttribute(EXTENSION_AUTH_ATTRIBUTE);
    if (!rawAuth) return;

    try {
      const parsed = JSON.parse(rawAuth);
      const nextAuth = {
        loggedIn: Boolean(parsed?.loggedIn),
        email: parsed?.email ?? null,
      };

      if (nextAuth.loggedIn !== this.websiteAuth.loggedIn || nextAuth.email !== this.websiteAuth.email) {
        this.websiteAuth = nextAuth;
        void this.safeStorageSet({ websiteAuth: this.websiteAuth });
      }
    } catch (e) { console.error('[DevWell Content] Auth parse error:', e); }
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new DevWellContentScript();
  });
} else {
  new DevWellContentScript();
}
