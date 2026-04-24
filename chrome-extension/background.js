const APP_URL_PATTERNS = [
  'http://localhost:5173/*',
  'http://127.0.0.1:5173/*',
  'http://localhost:5174/*',
  'http://127.0.0.1:5174/*',
];

const MONITOR_URL = 'monitor.html';

class DevWellBackground {
  constructor() {
    this.sessionActive = false;
    this.sessionData = null;
    this.alerts = [];
    this.lastFatigueAlertAt = 0;
    this.lastBreakReminderBucket = 0;
    this.extensionAuth = { token: null, email: null };
    this.websiteAuth = { loggedIn: false, email: null };
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
      'monitorTabId',
      'guestModeActive'
    ]);

    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.alerts = Array.isArray(result.alerts) ? result.alerts : [];
    this.extensionAuth = result.extensionAuth ?? this.extensionAuth;
    this.websiteAuth = result.websiteAuth ?? this.websiteAuth;
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
      if (!this.sessionActive) return;
      const currentDurationMinutes = this.sessionStartTime ? (Date.now() - this.sessionStartTime) / 60000 : 0;
      if (this.sessionData) {
        this.sessionData.sessionDurationMinutes = currentDurationMinutes;
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
      const res = await fetch('http://localhost:3001/api/v1/sessions', {
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
                await chrome.tabs.update(this.monitorTabId, { active: true });
                return { success: true };
            } catch { /* tab doesn't exist, proceed to create */ }
        }
        await chrome.storage.local.set({ sessionError: null });
        
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(MONITOR_URL), pinned: true });
        this.monitorTabId = tab.id;
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
        const currentDurationMinutes = this.sessionStartTime ? (Date.now() - this.sessionStartTime) / 60000 : 0;
        this.sessionData = { ...(this.sessionData ?? {}), ...message.data, sessionDurationMinutes: currentDurationMinutes };
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
          await chrome.storage.local.set({ websiteSettings: message.settings });
          
          // Also broadcast to any open extension popups
          await this.broadcastSettingsToPopups(message.settings);
          
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
    this.updateBadge();
    if (changes.sessionActive || changes.sessionData) {
      await this.broadcastState();
    }
  }

  async handleAlerts() {
    if (!this.sessionActive || !this.sessionData) return;
    const now = Date.now();
    const fatigueScore = this.sessionData.fatigueScore ?? 0;
    if (fatigueScore > 70 && (this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= 3600000)) {
      this.lastFatigueAlertAt = now;
      await this.pushAlert('fatigue_high', 'High fatigue detected. Please take a break now.');
    } else if (fatigueScore > 40 && (this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= 3600000)) {
      this.lastFatigueAlertAt = now;
      await this.pushAlert('fatigue_moderate', 'Moderate fatigue detected. Consider a short break.');
    }

    const breakBucket = Math.floor((this.sessionData.sessionDurationMinutes ?? 0) / 20);
    if (breakBucket > 0 && breakBucket > this.lastBreakReminderBucket) {
      this.lastBreakReminderBucket = breakBucket;
      await this.pushAlert('break', 'Time for a break. Follow the 20-20-20 rule.');
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
    const tabs = await chrome.tabs.query({ url: APP_URL_PATTERNS });
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
    const { appBaseUrl } = await chrome.storage.local.get('appBaseUrl');
    const tabs = await chrome.tabs.query({ url: `${appBaseUrl || 'http://localhost:5173'}/dashboard*` });
    if (tabs.length > 0 && tabs[0].id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      return;
    }
    await chrome.tabs.create({ url: `${appBaseUrl || 'http://localhost:5173'}/dashboard` });
  }
}

new DevWellBackground();
