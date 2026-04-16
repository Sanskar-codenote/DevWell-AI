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
    this.monitorTabId = null;

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
        console.log('[DevWell Background] Monitor tab closed by user.');
        // We treat this as a session stop event
        if (this.sessionActive) {
          void this.handleMessage({ action: 'monitorStopped', data: this.sessionData });
        }
        this.monitorTabId = null;
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
      'monitorTabId'
    ]);

    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.alerts = Array.isArray(result.alerts) ? result.alerts : [];
    this.extensionAuth = result.extensionAuth ?? this.extensionAuth;
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
        } catch (e) {
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

  async handleMessage(message) {
    switch (message?.action) {
      case 'getSessionState':
        return { success: true, sessionActive: this.sessionActive, sessionData: this.sessionData, alerts: this.alerts };

      case 'requestStartSession':
        if (!this.extensionAuth?.token) return { success: false, error: 'User not logged in' };
        if (this.monitorTabId) {
            try { // Focus existing tab
                await chrome.tabs.update(this.monitorTabId, { active: true });
                return { success: true };
            } catch (e) { /* tab doesn't exist, proceed to create */ }
        }
        await chrome.storage.local.set({ sessionError: null });
        
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(MONITOR_URL), pinned: true });
        this.monitorTabId = tab.id;
        await chrome.storage.local.set({ monitorTabId: this.monitorTabId });
        return { success: true };

      case 'requestStopSession':
        if (this.monitorTabId) {
            // Send a message to the tab first to gracefully stop streams
            await chrome.tabs.sendMessage(this.monitorTabId, { action: 'stop' }).catch(e => console.log('Monitor tab might already be closing.'));
            // The onRemoved listener will handle the rest of the cleanup.
            try {
                await chrome.tabs.remove(this.monitorTabId);
            } catch (e) {
                console.log('Error removing tab, maybe already closed:', e);
            }
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
        const currentDurationMinutes = this.sessionStartTime ? (Date.now() - this.sessionStartTime) / 60000 : 0;
        this.sessionData = { ...(this.sessionData ?? {}), ...message.data, sessionDurationMinutes: currentDurationMinutes };
        await chrome.storage.local.set({ sessionActive: true, sessionData: this.sessionData, sessionError: null });
        await this.handleAlerts();
        this.updateBadge();
        await this.broadcastState();
        return { success: true };

      case 'monitorStopped':
        this.sessionActive = false;
        this.stopSessionTimer();
        this.sessionData = message.data ?? this.sessionData;
        this.lastBreakReminderBucket = 0;
        
        if (this.sessionData && this.extensionAuth?.token) {
          const payload = {
            session_date: new Date().toISOString(),
            duration_minutes: this.sessionData.sessionDurationMinutes || 0,
            avg_blink_rate: this.sessionData.sessionAvgBlinkRate || 0,
            fatigue_score: this.sessionData.fatigueScore || 0,
            long_closure_events: this.sessionData.longClosureEvents || 0
          };
          fetch('http://localhost:3001/api/v1/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.extensionAuth.token}` },
            body: JSON.stringify(payload)
          }).then(res => {
            if (!res.ok) console.error('[DevWell Background] Failed to save session:', res.statusText);
            else console.log('[DevWell Background] Session successfully saved to database.');
          }).catch(err => console.error('[DevWell Background] Error saving session to database:', err));
        }

        this.sessionData = null;
        this.monitorTabId = null;
        await chrome.storage.local.set({ sessionActive: false, sessionData: null, sessionError: null, monitorTabId: null });
        
        this.updateBadge();
        await this.broadcastState();
        return { success: true };

      case 'monitorError':
        this.sessionActive = false;
        this.stopSessionTimer();
        await chrome.storage.local.set({ sessionActive: false, sessionError: message?.error || 'Monitor tab error' });
        console.error('[DevWell Background] Monitor tab error:', message.error);
        // The monitor tab itself will display the error, so we don't need to open another page.
        // We just need to close the failed tab if it's still open.
        if (this.monitorTabId) {
            try { await chrome.tabs.remove(this.monitorTabId); } catch(e) {}
        }
        this.monitorTabId = null;
        this.updateBadge();
        await this.broadcastState();
        return { success: false, error: message.error };

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
      if (!this.extensionAuth.token && this.sessionActive) {
        await this.handleMessage({ action: 'requestStopSession' });
      }
    }
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
    this.alerts = [...this.alerts.slice(-49), nextAlert];
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
