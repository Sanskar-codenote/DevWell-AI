// Clear stale session state on browser startup to prevent sessions from incorrectly
// resuming when the browser restores the previous tabs.
chrome.runtime.onStartup.addListener(() => {
  console.log('[DevWell Background] Browser startup: clearing stale session data.');
  chrome.storage.local.set({
    sessionActive: false,
    sessionData: null,
    monitorTabId: null,
    sessionError: null
  });
});

const APP_BASE_URL = '__APP_BASE_URL__';
const API_BASE_URL = '__API_BASE_URL__';

const MONITOR_URL = 'monitor.html';
const DEFAULT_NOTIFICATION_SETTINGS = {
  lowFatigueThreshold: 50,
  highFatigueThreshold: 80,
  fatigueNotificationIntervalMinutes: 60,
  enableModerateFatigueNotification: true,
  enableHighFatigueNotification: true,
  enableBreakNotification: true,
  lowBlinkRate: 15,
};

class DevWellBackground {
  constructor() {
    this.sessionActive = false;
    this.sessionData = null;
    this.alerts = [];
    this.lastFatigueAlertAt = 0;
    this.lastBreakReminderBucket = 0;
    this.extensionAuth = { token: null, email: null };
    this.websiteAuth = { loggedIn: false, email: null };
    this.extensionSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
    this.websiteSettings = { ...DEFAULT_NOTIFICATION_SETTINGS };
    this.hasExtensionSettings = false;
    this.hasWebsiteSettings = false;
    this.guestModeActive = false;
    this.monitorTabId = null;
    this.isFinalizingSession = false;
    this.isClosingMonitorTab = false;

    void this.init();
  }

  async init() {
    await this.hydrateState();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      void this.handleMessage(message, sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('[DevWell Background] Message error:', error);
          sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        });
      return true;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      void this.handleStorageChange(changes);
    });

    chrome.notifications.onClicked.addListener(() => {
      void this.openDashboard();
    });

    chrome.runtime.onSuspend.addListener(() => {
      if (this.monitorTabId) {
        chrome.tabs.remove(this.monitorTabId).catch(() => {});
      }
    });

    chrome.runtime.onConnect.addListener((port) => {
      console.log(`[DevWell Background] Port connected: ${port.name}`);
    });
    
    // Listener to detect when the monitor tab is closed by the user
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.monitorTabId) {
        const wasProgrammaticClose = this.isClosingMonitorTab;
        this.isClosingMonitorTab = false;
        this.monitorTabId = null;
        void chrome.storage.local.set({ monitorTabId: null });

        if (wasProgrammaticClose) {
          console.log('[DevWell Background] Monitor tab closed programmatically.');
          return;
        }

        console.log('[DevWell Background] Monitor tab closed by user.');
        if (this.sessionActive || this.sessionData) {
          void this.finalizeSession(this.sessionData, { reason: 'Monitor tab was closed' });
        }
      }
    });

    this.updateBadge();
    await this.broadcastState();
  }

  async hydrateState() {
    const result = await chrome.storage.local.get([
      'sessionActive',
      'sessionData',
      'alerts',
      'extensionAuth',
      'websiteAuth',
      'extensionSettings',
      'websiteSettings',
      'monitorTabId',
      'guestModeActive'
    ]);

    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.alerts = Array.isArray(result.alerts) ? result.alerts : [];
    this.extensionAuth = result.extensionAuth ?? this.extensionAuth;
    this.websiteAuth = result.websiteAuth ?? this.websiteAuth;
    this.hasExtensionSettings = Boolean(result.extensionSettings);
    this.hasWebsiteSettings = Boolean(result.websiteSettings);
    this.extensionSettings = this.normalizeNotificationSettings(result.extensionSettings);
    this.websiteSettings = this.normalizeNotificationSettings(result.websiteSettings);
    this.guestModeActive = Boolean(result.guestModeActive);
    this.monitorTabId = result.monitorTabId ?? null;
    this.lastBreakReminderBucket = Math.floor((this.sessionData?.sessionDurationMinutes ?? 0) / 20);

    if (this.sessionActive) {
       this.sessionStartTime = Date.now() - ((this.sessionData?.sessionDurationMinutes ?? 0) * 60000);
       this.startSessionTimer();
    }
    
    // Check if the stored tab ID is still valid
    if (this.monitorTabId) {
        try {
            await chrome.tabs.get(this.monitorTabId);
        } catch {
            // The tab doesn't exist anymore, session must have been interrupted
            console.log('[DevWell Background] Monitor tab not found on startup, resetting session.');
            this.monitorTabId = null;
            this.sessionActive = false;
            this.sessionData = null;
            await chrome.storage.local.set({ sessionActive: false, sessionData: null, monitorTabId: null });
        }
    }
  }

  startSessionTimer() {
    this.stopSessionTimer();
    this.sessionTimer = setInterval(() => {
      if (!this.sessionActive || this.sessionData?.isPaused) return;
      
      const now = Date.now();
      const currentPauseDuration = this.sessionData?.isPaused ? (now - this.sessionData.pauseStartAt) : 0;
      const effectiveElapsedMs = now - this.sessionStartTime - ((this.sessionData?.totalPausedTime || 0) + currentPauseDuration);
      
      if (this.sessionData) {
        this.sessionData.sessionDurationMinutes = Math.max(0, effectiveElapsedMs / 60000);
      }
      this.updateBadge();
      this.broadcastState().catch(() => undefined);
    }, 1000);
  }

  stopSessionTimer() {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  formatSessionDetails(data) {
    if (!data) return 'No session metrics were available.';
    const duration = Number(data.sessionDurationMinutes ?? 0).toFixed(1);
    const blinks = Number(data.blinkCount ?? 0);
    const avgBlinkRate = Number(data.sessionAvgBlinkRate ?? 0);
    const fatigue = Number(data.fatigueScore ?? 0);
    return `Duration ${duration}m | Blinks ${blinks} | Avg ${avgBlinkRate}/min | Fatigue ${fatigue}`;
  }

  getAuthMismatchMessage() {
    if (!this.extensionAuth?.token) return null;
    if (!this.websiteAuth?.loggedIn) return null;

    const extensionEmail = String(this.extensionAuth?.email ?? '').trim().toLowerCase();
    const websiteEmail = String(this.websiteAuth?.email ?? '').trim().toLowerCase();
    if (!extensionEmail || !websiteEmail) return null;
    if (extensionEmail === websiteEmail) return null;

    return `Account mismatch: website is logged in as ${websiteEmail}, extension is logged in as ${extensionEmail}. Please use the same account.`;
  }

  normalizeNotificationSettings(settings) {
    const base = settings ?? {};
    const lowFatigueThreshold = Number(base.lowFatigueThreshold ?? DEFAULT_NOTIFICATION_SETTINGS.lowFatigueThreshold);
    const highFatigueThreshold = Number(base.highFatigueThreshold ?? DEFAULT_NOTIFICATION_SETTINGS.highFatigueThreshold);
    const fatigueNotificationIntervalMinutes = Number(
      base.fatigueNotificationIntervalMinutes ?? DEFAULT_NOTIFICATION_SETTINGS.fatigueNotificationIntervalMinutes
    );
    const lowBlinkRate = Number(base.lowBlinkRate ?? DEFAULT_NOTIFICATION_SETTINGS.lowBlinkRate);

    return {
      lowFatigueThreshold: Number.isFinite(lowFatigueThreshold) ? lowFatigueThreshold : DEFAULT_NOTIFICATION_SETTINGS.lowFatigueThreshold,
      highFatigueThreshold: Number.isFinite(highFatigueThreshold) ? highFatigueThreshold : DEFAULT_NOTIFICATION_SETTINGS.highFatigueThreshold,
      fatigueNotificationIntervalMinutes: Number.isFinite(fatigueNotificationIntervalMinutes)
        ? fatigueNotificationIntervalMinutes
        : DEFAULT_NOTIFICATION_SETTINGS.fatigueNotificationIntervalMinutes,
      enableModerateFatigueNotification: base.enableModerateFatigueNotification !== false,
      enableHighFatigueNotification: base.enableHighFatigueNotification !== false,
      enableBreakNotification: base.enableBreakNotification ?? base.enable20MinNotification ?? true,
      lowBlinkRate: Number.isFinite(lowBlinkRate) ? lowBlinkRate : DEFAULT_NOTIFICATION_SETTINGS.lowBlinkRate,
    };
  }

  getEffectiveNotificationSettings() {
    if (this.hasExtensionSettings) {
      return this.normalizeNotificationSettings(this.extensionSettings);
    }
    if (this.hasWebsiteSettings) {
      return this.normalizeNotificationSettings(this.websiteSettings);
    }
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }

  async closeMonitorTab() {
    if (!this.monitorTabId) return;
    const tabId = this.monitorTabId;
    this.isClosingMonitorTab = true;
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      console.log('[DevWell Background] Monitor tab may already be closed:', error);
      this.isClosingMonitorTab = false;
      if (this.monitorTabId === tabId) {
        this.monitorTabId = null;
        await chrome.storage.local.set({ monitorTabId: null });
      }
    }
  }

  async saveSessionToBackend(sessionData) {
    if (!sessionData) {
      return { saved: false, reason: 'no_data' };
    }

    if (!this.extensionAuth?.token) {
      return { saved: false, reason: 'not_logged_in' };
    }

    const payload = {
      session_date: new Date().toISOString().split('T')[0],
      duration_minutes: sessionData.sessionDurationMinutes || 0,
      avg_blink_rate: sessionData.sessionAvgBlinkRate || 0,
      fatigue_score: sessionData.fatigueScore || 0,
      long_closure_events: sessionData.longClosureEvents || 0
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.extensionAuth.token}` },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.error('[DevWell Background] Failed to save session:', res.status, res.statusText);
        return { saved: false, reason: 'request_failed', status: res.status };
      }

      console.log('[DevWell Background] Session successfully saved to database.');
      return { saved: true };
    } catch (err) {
      console.error('[DevWell Background] Error saving session to database:', err);
      return { saved: false, reason: 'network_error' };
    }
  }

  async saveGuestSession(sessionData) {
    if (!sessionData) return { saved: false };
    
    try {
      const result = await chrome.storage.local.get('guestSessions');
      const sessions = result.guestSessions || [];
      
      const newSession = {
        timestamp: Date.now(),
        durationMinutes: sessionData.sessionDurationMinutes || 0,
        blinkRate: sessionData.sessionAvgBlinkRate || 0,
        blinkCount: sessionData.blinkCount || 0,
        fatigueScore: sessionData.fatigueScore || 0,
        drowsyEvents: sessionData.longClosureEvents || 0
      };
      
      // Add to beginning of array to show newest first
      sessions.unshift(newSession);
      
      // Limit to 50 sessions to save space
      const limitedSessions = sessions.slice(0, 50);
      
      await chrome.storage.local.set({ guestSessions: limitedSessions });
      console.log('[DevWell Background] Guest session saved locally.');
      return { saved: true };
    } catch (err) {
      console.error('[DevWell Background] Error saving guest session:', err);
      return { saved: false };
    }
  }

  async finalizeSession(finalData, { reason = 'Session ended' } = {}) {
    if (this.isFinalizingSession) {
      return { success: true };
    }

    if (!this.sessionActive && !this.sessionData && !finalData) {
      return { success: true };
    }

    this.isFinalizingSession = true;
    try {
      this.sessionActive = false;
      this.stopSessionTimer();
      this.lastBreakReminderBucket = 0;

      const sessionSnapshot = finalData ?? this.sessionData;
      await this.closeMonitorTab();

      const details = this.formatSessionDetails(sessionSnapshot);
      
      let saveResult = { saved: false };
      if (this.extensionAuth?.token) {
        saveResult = await this.saveSessionToBackend(sessionSnapshot);
      } else if (this.guestModeActive) {
        saveResult = await this.saveGuestSession(sessionSnapshot);
      }

      if (saveResult.saved) {
        const message = this.guestModeActive && !this.extensionAuth?.token 
          ? `Guest session saved locally. ${details}`
          : `Session saved. ${details}`;
        await this.pushAlert('session_saved', message);
      } else if (!this.extensionAuth?.token && !this.guestModeActive) {
        await this.pushAlert('session_local_only', `Session ended (not saved: login required). ${details}`);
      } else if (sessionSnapshot) {
        await this.pushAlert('session_save_failed', `Session ended (save failed). ${details}`);
      } else {
        await this.pushAlert('session_ended', `${reason}.`);
      }

      this.sessionData = null;
      this.monitorTabId = null;
      await chrome.storage.local.set({
        sessionActive: false,
        sessionData: null,
        sessionError: null,
        monitorTabId: null
      });

      this.updateBadge();
      await this.broadcastState();
      return { success: true };
    } finally {
      this.isFinalizingSession = false;
    }
  }

  async handleMessage(message) {
    switch (message?.action) {
      case 'getSessionState':
        return { success: true, sessionActive: this.sessionActive, sessionData: this.sessionData, alerts: this.alerts };

      case 'requestStartSession':
        if (!this.extensionAuth?.token && !this.guestModeActive) return { success: false, error: 'User not logged in' };
        
        if (this.extensionAuth?.token) {
          const mismatch = this.getAuthMismatchMessage();
          if (mismatch) {
            await this.pushAlert('auth_mismatch', mismatch);
            return { success: false, error: mismatch };
          }
        }
        if (this.monitorTabId) {
            try { // Focus existing tab
                await chrome.tabs.update(this.monitorTabId, { active: true, autoDiscardable: false });
                return { success: true };
            } catch { /* tab doesn't exist, proceed to create */ }
        }
        await chrome.storage.local.set({ sessionError: null });
        
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(MONITOR_URL), pinned: true });
        this.monitorTabId = tab.id;
        if (this.monitorTabId) {
          await chrome.tabs.update(this.monitorTabId, { autoDiscardable: false }).catch(() => undefined);
        }
        
        const startListener = (tabId, changeInfo) => {
          if (tabId === this.monitorTabId && changeInfo.status === 'complete') {
            chrome.tabs.sendMessage(tabId, { action: 'start' }).catch(e => console.log('Error sending start message to monitor tab.', e));
            chrome.tabs.onUpdated.removeListener(startListener);
          }
        };
        chrome.tabs.onUpdated.addListener(startListener);
        
        await chrome.storage.local.set({ monitorTabId: this.monitorTabId });
        return { success: true };

      case 'requestStopSession':
        if (this.monitorTabId) {
          // Ask monitor to stop camera streams gracefully before closing.
          await chrome.tabs.sendMessage(this.monitorTabId, { action: 'stop' }).catch((e) => {
            console.log('[DevWell Background] Monitor tab might already be closing.', e);
          });
        }
        return this.finalizeSession(this.sessionData, { reason: 'Session stopped from extension popup' });

      case 'requestPauseSession':
        if (this.monitorTabId) {
          await chrome.tabs.sendMessage(this.monitorTabId, { action: 'pause' }).catch(() => {});
        }
        return { success: true };

      case 'requestResumeSession':
        if (this.monitorTabId) {
          await chrome.tabs.sendMessage(this.monitorTabId, { action: 'resume' }).catch(() => {});
        }
        return { success: true };

      case 'monitorStarted':
        this.sessionActive = true;
        this.sessionStartTime = Date.now();
        this.sessionData = { ...(message.data ?? {}), sessionDurationMinutes: 0 };
        this.lastBreakReminderBucket = 0;
        await chrome.storage.local.set({ sessionActive: true, sessionData: this.sessionData, sessionError: null });
        this.startSessionTimer();
        this.updateBadge();
        await this.broadcastState();
        return { success: true };

      case 'monitorMetrics':
        if (!message.data) return { success: false, error: 'Missing session data' };
        this.sessionActive = true;
        
        const isPausedFromMonitor = message.data.isPaused;
        const totalPausedTime = message.data.totalPausedTime || (this.sessionData?.totalPausedTime || 0);
        const pauseStartAt = message.data.pauseStartAt || (this.sessionData?.pauseStartAt || 0);
        
        const now = Date.now();
        const currentPauseDuration = isPausedFromMonitor ? (now - pauseStartAt) : 0;
        const effectiveElapsedMs = now - this.sessionStartTime - (totalPausedTime + currentPauseDuration);
        const currentDurationMinutes = this.sessionStartTime ? Math.max(0, effectiveElapsedMs / 60000) : 0;
        
        this.sessionData = { 
          ...(this.sessionData ?? {}), 
          ...message.data, 
          sessionDurationMinutes: currentDurationMinutes,
          totalPausedTime,
          pauseStartAt
        };
        await chrome.storage.local.set({ sessionActive: true, sessionData: this.sessionData, sessionError: null });
        await this.handleAlerts();
        this.updateBadge();
        await this.broadcastState();
        return { success: true };

      case 'monitorStopped':
        return this.finalizeSession(message.data ?? this.sessionData, { reason: 'Session stopped by monitor' });

      case 'monitorError':
        this.sessionActive = false;
        this.stopSessionTimer();
        await chrome.storage.local.set({ sessionActive: false, sessionError: message?.error || 'Monitor tab error' });
        console.error('[DevWell Background] Monitor tab error:', message.error);
        await this.pushAlert('session_error', `Session stopped due to error: ${message?.error || 'Unknown monitor error'}`);
        await this.closeMonitorTab();
        this.monitorTabId = null;
        this.updateBadge();
        await this.broadcastState();
        return { success: false, error: message.error };

      case 'syncWebsiteSettings':
        if (message.settings) {
          this.hasWebsiteSettings = true;
          this.websiteSettings = this.normalizeNotificationSettings(message.settings);
          await chrome.storage.local.set({ websiteSettings: this.websiteSettings });
          
          // Also broadcast to any open extension popups
          await this.broadcastSettingsToPopups(this.websiteSettings);
          
          return { success: true };
        }
        return { success: false, error: 'Missing settings data' };

      default:
        return { success: false, error: 'Unknown action' };
    }
  }

  async handleStorageChange(changes) {
    if (changes.sessionActive) this.sessionActive = Boolean(changes.sessionActive.newValue);
    if (changes.sessionData) this.sessionData = changes.sessionData.newValue ?? null;
    if (changes.alerts) this.alerts = Array.isArray(changes.alerts.newValue) ? changes.alerts.newValue : [];
    if (changes.extensionAuth) {
      this.extensionAuth = changes.extensionAuth.newValue ?? this.extensionAuth;
      if (!this.extensionAuth.token && this.sessionActive && !this.guestModeActive) {
        await this.handleMessage({ action: 'requestStopSession' });
      }
      if (!this.extensionAuth.token) {
        this.alerts = [];
        await chrome.storage.local.set({ alerts: [] });
      }
    }
    if (changes.guestModeActive) {
      this.guestModeActive = Boolean(changes.guestModeActive.newValue);
    }
    if (changes.websiteAuth) this.websiteAuth = changes.websiteAuth.newValue ?? this.websiteAuth;
    if (changes.extensionSettings) {
      this.hasExtensionSettings = Boolean(changes.extensionSettings.newValue);
      this.extensionSettings = this.normalizeNotificationSettings(changes.extensionSettings.newValue);
    }
    if (changes.websiteSettings) {
      this.hasWebsiteSettings = Boolean(changes.websiteSettings.newValue);
      this.websiteSettings = this.normalizeNotificationSettings(changes.websiteSettings.newValue);
    }
    this.updateBadge();
    if (changes.sessionActive || changes.sessionData) {
      await this.broadcastState();
    }
  }

  async handleAlerts() {
    if (!this.sessionActive || !this.sessionData) return;
    const settings = this.getEffectiveNotificationSettings();
    const now = Date.now();
    const fatigueScore = this.sessionData.fatigueScore ?? 0;
    const fatigueIntervalMs = Math.max(1, settings.fatigueNotificationIntervalMinutes) * 60 * 1000;
    const fatigueCooldownReady = this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= fatigueIntervalMs;

    if (fatigueCooldownReady) {
      const isHighFatigue = fatigueScore > settings.highFatigueThreshold;
      const isModerateFatigue = fatigueScore > settings.lowFatigueThreshold && !isHighFatigue;

      if (isHighFatigue && settings.enableHighFatigueNotification) {
        this.lastFatigueAlertAt = now;
        await this.pushAlert('fatigue_high', 'High fatigue detected. Please take a break now.');
      } else if (isModerateFatigue && settings.enableModerateFatigueNotification) {
        this.lastFatigueAlertAt = now;
        await this.pushAlert('fatigue_moderate', 'Moderate fatigue detected. Consider a short break.');
      }
    }

    if (settings.enableBreakNotification) {
      const breakBucket = Math.floor((this.sessionData.sessionDurationMinutes ?? 0) / 20);
      if (breakBucket > 0 && breakBucket > this.lastBreakReminderBucket) {
        this.lastBreakReminderBucket = breakBucket;
        await this.pushAlert('break', 'Time for a break. Follow the 20-20-20 rule.');
      }
    }
  }

  async pushAlert(type, message) {
    const nextAlert = { type, message, timestamp: Date.now() };
    this.alerts = [...this.alerts.slice(-4), nextAlert];
    await chrome.storage.local.set({ alerts: this.alerts });
    chrome.notifications.create(`devwell-${nextAlert.timestamp}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'DevWell AI',
      message,
      priority: type === 'fatigue_high' ? 2 : 1,
    });
  }

  updateBadge() {
    if (!this.sessionActive || !this.sessionData) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }
    const minutes = Math.max(0, Math.floor(this.sessionData.sessionDurationMinutes ?? 0));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    chrome.action.setBadgeText({ text: hours > 0 ? `${hours}h` : `${remainingMinutes}m` });
    if ((this.sessionData.fatigueScore ?? 0) > 70) chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    else if ((this.sessionData.fatigueScore ?? 0) > 40) chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    else chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  }

  async broadcastState() {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (!tab.id) return Promise.resolve();
        return chrome.tabs.sendMessage(tab.id, {
          action: 'sessionStateUpdate',
          sessionActive: this.sessionActive,
          sessionData: this.sessionData,
        }).catch(() => undefined);
      })
    );
  }

  async broadcastSettingsToPopups(settings) {
    // Get all extension popup windows
    const windows = await chrome.windows.getAll({ populate: true });
    
    for (const win of windows) {
      for (const tab of win.tabs || []) {
        if (tab.url?.includes('popup.html')) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'syncSettings',
              settings: settings
            });
          } catch (e) {
            // Popup might be closed or not ready
          }
        }
      }
    }
  }

  async openDashboard() {
    const tabs = await chrome.tabs.query({ url: `${APP_BASE_URL}/dashboard*` });
    if (tabs.length > 0 && tabs[0].id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      return;
    }
    await chrome.tabs.create({ url: `${APP_BASE_URL}/dashboard` });
  }
}

new DevWellBackground();
