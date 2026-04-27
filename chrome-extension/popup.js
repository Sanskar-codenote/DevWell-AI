const APP_BASES = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

class DevWellPopup {
  constructor() {
    this.sessionActive = false;
    this.sessionData = null;
    this.alerts = [];
    this.isLoggedIn = false;
    this.userEmail = null;
    this.guestModeActive = false;
    this.websiteAuth = { loggedIn: false, email: null };
    this.elements = {};

    void this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.bindStorageUpdates();
    await this.loadState();
    this.updateUI();
  }

  cacheElements() {
    this.elements.loginSection = document.getElementById('loginSection');
    this.elements.dashboardSection = document.getElementById('dashboardSection');
    this.elements.loginForm = document.getElementById('loginForm');
    this.elements.emailInput = document.getElementById('email');
    this.elements.passwordInput = document.getElementById('password');
    this.elements.loginBtn = document.getElementById('loginBtn');
    this.elements.logoutBtn = document.getElementById('logoutBtn');
    this.elements.userEmail = document.getElementById('userEmail');
    
    this.elements.sessionBtn = document.getElementById('sessionBtn');
    this.elements.viewAnalyticsBtn = document.getElementById('viewAnalyticsBtn');
    this.elements.settingsBtn = document.getElementById('settingsBtn');
    this.elements.guestModeBtn = document.getElementById('guestModeBtn');
    this.elements.statusIndicator = document.getElementById('statusIndicator');
    this.elements.sessionTime = document.getElementById('sessionTime');
    this.elements.blinkRate = document.getElementById('blinkRate');
    this.elements.totalBlinks = document.getElementById('totalBlinks');
    this.elements.drowsyEvents = document.getElementById('drowsyEvents');
    this.elements.fatigueScore = document.getElementById('fatigueScore');
    this.elements.fatigueLevel = document.getElementById('fatigueLevel');
    this.elements.progressFill = document.getElementById('progressFill');
    this.elements.alertsList = document.getElementById('alertsList');
    
    // Settings elements
    this.elements.settingsSection = document.getElementById('settingsSection');
    this.elements.saveSettingsBtn = document.getElementById('saveSettingsBtn');
    this.elements.cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    this.elements.lowFatigueThresholdInput = document.getElementById('lowFatigueThreshold');
    this.elements.highFatigueThresholdInput = document.getElementById('highFatigueThreshold');
    this.elements.fatigueNotificationIntervalInput = document.getElementById('fatigueNotificationInterval');
    this.elements.enableModerateFatigueNotificationInput = document.getElementById('enableModerateFatigueNotification');
    this.elements.enableHighFatigueNotificationInput = document.getElementById('enableHighFatigueNotification');
    this.elements.enableBreakNotificationInput = document.getElementById('enableBreakNotification');
    this.elements.lowFatigueValueDisplay = document.getElementById('lowFatigueValue');
    this.elements.highFatigueValueDisplay = document.getElementById('highFatigueValue');
    this.elements.fatigueIntervalValueDisplay = document.getElementById('fatigueIntervalValue');
    

  }

  bindEvents() {
    this.elements.loginForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.handleLogin();
    });

    this.elements.logoutBtn?.addEventListener('click', () => {
      void this.handleLogout();
    });

    this.elements.sessionBtn?.addEventListener('click', () => {
      void this.handleSessionAction();
    });

    this.elements.settingsBtn?.addEventListener('click', () => {
      void this.toggleSettings();
    });

    this.elements.guestModeBtn?.addEventListener('click', async () => {
      console.log('Guest mode button clicked - entering guest mode');
      try {
        // Enter guest mode - show the guest mode section in the popup
        this.toggleGuestMode();
        console.log('Guest mode activated successfully');
      } catch (err) {
        console.error('Failed to enter guest mode:', err);
        alert('Failed to enter guest mode. Error: ' + err.message);
      }
    });

    document.getElementById('backToDashboard')?.addEventListener('click', () => {
      this.toggleSettings();
    });

    this.elements.saveSettingsBtn?.addEventListener('click', () => {
      void this.saveSettings();
    });

    this.elements.cancelSettingsBtn?.addEventListener('click', () => {
      this.toggleSettings();
    });

    // Slider event listeners
    this.elements.lowFatigueThresholdInput?.addEventListener('input', () => {
      this.updateSliderDisplay();
    });

    this.elements.highFatigueThresholdInput?.addEventListener('input', () => {
      this.updateSliderDisplay();
    });
    this.elements.fatigueNotificationIntervalInput?.addEventListener('input', () => {
      this.updateSliderDisplay();
    });

    this.elements.viewAnalyticsBtn?.addEventListener('click', () => {
      if (this.guestModeActive && !this.isLoggedIn) {
        void this.openGuestAnalytics();
        return;
      }
      void this.openAppRoute('/analytics');
    });

    // Listen for syncSettings messages from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'syncSettings') {
        console.log('[Popup] Received syncSettings message from background:', message.settings);
        this.settings = message.settings;
        // If settings view is open, update the form
        if (this.elements.settingsSection?.style.display !== 'none') {
          this.loadSettingsToForm();
        }
        sendResponse({ success: true });
      }
    });
  }

  bindStorageUpdates() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.sessionActive) {
        this.sessionActive = Boolean(changes.sessionActive.newValue);
      }

      if (changes.sessionData) {
        this.sessionData = changes.sessionData.newValue ?? null;
      }

      if (changes.alerts) {
        this.alerts = Array.isArray(changes.alerts.newValue) ? changes.alerts.newValue : [];
      }

      if (changes.extensionAuth) {
        const auth = changes.extensionAuth.newValue;
        this.isLoggedIn = Boolean(auth?.token);
        this.userEmail = auth?.email ?? null;
      }
      if (changes.websiteAuth) {
        this.websiteAuth = changes.websiteAuth.newValue ?? this.websiteAuth;
      }

      // Sync settings from website to extension
      if (changes.websiteSettings) {
        this.settings = changes.websiteSettings.newValue;
        // If settings view is open, update the form
        if (this.elements.settingsSection?.style.display !== 'none') {
          this.loadSettingsToForm();
        }
      }

      this.updateUI();
    });
  }

  async loadState() {
    const result = await chrome.storage.local.get([
      'sessionActive',
      'sessionData',
      'alerts',
      'extensionAuth',
      'websiteAuth',
      'extensionSettings',
      'guestModeActive',
    ]);

    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.alerts = Array.isArray(result.alerts) ? result.alerts : [];
    
    const auth = result.extensionAuth;
    this.isLoggedIn = Boolean(auth?.token);
    this.userEmail = auth?.email ?? null;
    this.websiteAuth = result.websiteAuth ?? this.websiteAuth;
    this.guestModeActive = Boolean(result.guestModeActive);
    
    // Load settings
    this.settings = result.extensionSettings || {
      lowFatigueThreshold: 50,
      highFatigueThreshold: 80,
      fatigueNotificationIntervalMinutes: 60,
      enableModerateFatigueNotification: true,
      enableHighFatigueNotification: true,
      enableBreakNotification: true,
    };
    

  }

  getAuthMismatchMessage(targetEmail = null) {
    if (!this.websiteAuth?.loggedIn || !this.websiteAuth?.email) return null;

    const websiteEmail = String(this.websiteAuth.email).trim().toLowerCase();
    const extensionEmail = String(targetEmail ?? this.userEmail ?? '').trim().toLowerCase();

    if (!websiteEmail || !extensionEmail || websiteEmail === extensionEmail) return null;

    return `Account mismatch: website is logged in as ${websiteEmail}. Please log in to extension with the same account.`;
  }

  async handleLogin() {
    const email = this.elements.emailInput.value;
    const password = this.elements.passwordInput.value;

    if (!email || !password) {
      this.showError('Please enter both email and password');
      return;
    }

    const preLoginMismatch = this.getAuthMismatchMessage(email);
    if (preLoginMismatch) {
      this.showError(preLoginMismatch);
      return;
    }

    this.elements.loginBtn.disabled = true;
    this.elements.loginBtn.textContent = 'Logging in...';

    try {
      const response = await fetch('http://localhost:3001/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      await chrome.storage.local.set({
        extensionAuth: {
          token: data.token,
          email: email,
          userId: data.user?.id,
        },
        guestModeActive: false
      });

      this.isLoggedIn = true;
      this.userEmail = email;
      this.guestModeActive = false;
      this.updateUI();
    } catch (err) {
      console.error('[DevWell Popup] Login error:', err);
      this.showError(err.message || 'Connection error');
    } finally {
      this.elements.loginBtn.disabled = false;
      this.elements.loginBtn.textContent = 'Log In';
    }
  }

  async handleLogout() {
    if (this.sessionActive) {
      await this.sendRuntimeMessage('requestStopSession');
    }

    if (this.guestModeActive) {
      await this.toggleGuestMode();
      return;
    }

    await chrome.storage.local.remove('extensionAuth');
    await chrome.storage.local.set({ alerts: [] });
    this.alerts = [];
    this.isLoggedIn = false;
    this.userEmail = null;
    this.updateUI();
  }

  async handleSessionAction() {
    if (!this.isLoggedIn && !this.guestModeActive) return;

    if (this.isLoggedIn) {
      const mismatch = this.getAuthMismatchMessage();
      if (mismatch) {
        this.showError(mismatch);
        return;
      }
    }

    if (!this.sessionActive) {
      // Start session - open monitor tab first
      const response = await this.sendRuntimeMessage('requestStartSession');
      if (response && !response.success) {
        this.showError(response.error || 'Failed to start session');
        return;
      }
      // Monitor tab will be opened by background.js
    } else {
      // End session
      await this.sendRuntimeMessage('requestStopSession');
    }
  }

  async sendRuntimeMessage(action) {
    try {
      return await chrome.runtime.sendMessage({ action });
    } catch (err) {
      const message = err?.message || 'Failed to communicate with extension background service';
      if (message.includes('Receiving end does not exist')) {
        this.showError('Extension reloaded. Please close and reopen the popup.');
      } else {
        this.showError(message);
      }
      return null;
    }
  }

  updateUI() {
    if (!this.isLoggedIn && !this.guestModeActive) {
      this.elements.loginSection.style.display = 'block';
      this.elements.dashboardSection.style.display = 'none';
      this.elements.statusIndicator.classList.remove('active');
      this.elements.statusIndicator.querySelector('.status-text').textContent = 'Logged Out';
      return;
    }

    this.elements.loginSection.style.display = 'none';
    this.elements.dashboardSection.style.display = 'block';

    if (this.elements.userEmail) {
      this.elements.userEmail.textContent = this.isLoggedIn ? this.userEmail : '👤 Guest User';
    }

    const statusText = this.elements.statusIndicator?.querySelector('.status-text');
    if (this.sessionActive) {
      this.elements.statusIndicator?.classList.add('active');
      if (statusText) statusText.textContent = 'Monitoring';
    } else {
      this.elements.statusIndicator?.classList.remove('active');
      if (statusText) statusText.textContent = this.isLoggedIn ? 'Ready' : 'Guest Mode';
    }

    if (this.elements.sessionBtn) {
      this.elements.sessionBtn.textContent = this.sessionActive ? 'End Session' : 'Start Session';
      this.elements.sessionBtn.className = this.sessionActive ? 'btn btn-outline' : 'btn btn-primary';
    }
    
    // Update settings button visibility based on login state
    if (this.elements.settingsBtn) {
      this.elements.settingsBtn.style.display = this.isLoggedIn ? 'inline-block' : 'none';
    }
    
    // Update logout button: show only if logged in
    if (this.elements.logoutBtn) {
      this.elements.logoutBtn.style.display = (this.isLoggedIn || this.guestModeActive) ? 'inline-block' : 'none';
      this.elements.logoutBtn.textContent = this.isLoggedIn ? 'Log Out' : 'Exit Guest';
    }

    if (this.elements.viewAnalyticsBtn) {
      this.elements.viewAnalyticsBtn.style.display = 'inline-block';
    }
    
    // Update guest mode button visibility - show only on login page when not in guest mode
    if (this.elements.guestModeBtn) {
      this.elements.guestModeBtn.style.display = this.isLoggedIn || this.guestModeActive ? 'none' : 'block';
    }

    const sessionDuration = this.sessionData?.sessionDurationMinutes ?? 0;
    const blinkRate = this.sessionData?.currentBlinkRate || this.sessionData?.sessionAvgBlinkRate || 0;
    const blinkCount = this.sessionData?.blinkCount ?? 0;
    const drowsyEvents = this.sessionData?.longClosureEvents ?? 0;
    const fatigueScore = this.sessionData?.fatigueScore ?? 0;
    const fatigueLevel = this.sessionData?.fatigueLevel ?? 'Fresh';

    if (this.elements.sessionTime) {
      this.elements.sessionTime.textContent = this.formatDuration(sessionDuration);
    }

    if (this.elements.blinkRate) {
      this.elements.blinkRate.textContent = `${blinkRate}/min`;
    }

    if (this.elements.totalBlinks) {
      this.elements.totalBlinks.textContent = String(blinkCount);
    }

    if (this.elements.drowsyEvents) {
      this.elements.drowsyEvents.textContent = String(drowsyEvents);
    }

    if (this.elements.fatigueScore) {
      this.elements.fatigueScore.textContent = String(fatigueScore);
    }

    if (this.elements.fatigueLevel) {
      this.elements.fatigueLevel.textContent = fatigueLevel;
      this.elements.fatigueLevel.className = 'fatigue-level';
    }

    if (this.elements.progressFill) {
      this.elements.progressFill.style.width = `${Math.max(0, Math.min(100, fatigueScore))}%`;
      this.elements.progressFill.className = 'progress-fill';
    }

    if (fatigueScore > 70) {
      this.elements.progressFill?.classList.add('high');
      this.elements.fatigueLevel?.classList.add('high');
    } else if (fatigueScore > 40) {
      this.elements.progressFill?.classList.add('moderate');
      this.elements.fatigueLevel?.classList.add('moderate');
    }

    this.renderAlerts();
  }

  renderAlerts() {
    if (!this.elements.alertsList) return;

    const recentAlerts = [...this.alerts].slice(-5).reverse();
    if (recentAlerts.length === 0) {
      this.elements.alertsList.innerHTML = '<div class="alert-empty">No alerts yet</div>';
      return;
    }

    this.elements.alertsList.innerHTML = recentAlerts.map((alert) => {
      const typeClass = alert.type === 'fatigue_high' || alert.type === 'session_save_failed' || alert.type === 'session_error' || alert.type === 'auth_mismatch'
        ? 'danger'
        : alert.type === 'fatigue_moderate' || alert.type === 'break' || alert.type === 'session_local_only'
          ? 'warning'
          : '';
      return `
        <div class="alert-item ${typeClass}">
          <button class="alert-close-btn" data-alert-ts="${alert.timestamp}" title="Dismiss alert" aria-label="Dismiss alert">&times;</button>
          <div class="alert-message">${alert.message}</div>
          <div class="alert-time">${new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      `;
    }).join('');

    this.elements.alertsList.querySelectorAll('.alert-close-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ts = Number(button.getAttribute('data-alert-ts'));
        void this.dismissAlert(ts);
      });
    });
  }

  async dismissAlert(timestamp) {
    if (!Number.isFinite(timestamp)) return;
    this.alerts = this.alerts.filter((alert) => Number(alert.timestamp) !== timestamp);
    await chrome.storage.local.set({ alerts: this.alerts.slice(-5) });
    this.renderAlerts();
  }

  async openAppRoute(pathname) {
    const tabs = await chrome.tabs.query({
      url: APP_BASES.flatMap((base) => `${base}${pathname}*`),
    });

    if (tabs.length > 0 && tabs[0].id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      return tabs[0];
    }

    return chrome.tabs.create({ url: `${this.appBaseUrl || APP_BASES[0]}${pathname}` });
  }

  showError(message) {
    document.querySelector('.error-banner')?.remove();

    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = message;

    document.querySelector('.container')?.prepend(banner);
    window.setTimeout(() => banner.remove(), 5000);
  }
  formatDuration(minutes) {
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  toggleSettings() {
    const isVisible = this.elements.settingsSection?.style.display !== 'none';
    if (this.elements.settingsSection) {
      this.elements.settingsSection.style.display = isVisible ? 'none' : 'block';
    }
    
    if (!isVisible) {
      this.loadSettingsToForm();
    }
  }

  loadSettingsToForm() {
    if (this.settings) {
      if (this.elements.lowFatigueThresholdInput) {
        this.elements.lowFatigueThresholdInput.value = String(this.settings.lowFatigueThreshold);
      }
      if (this.elements.highFatigueThresholdInput) {
        this.elements.highFatigueThresholdInput.value = String(this.settings.highFatigueThreshold);
      }
      if (this.elements.fatigueNotificationIntervalInput) {
        this.elements.fatigueNotificationIntervalInput.value = String(this.settings.fatigueNotificationIntervalMinutes ?? 60);
      }
      if (this.elements.enableModerateFatigueNotificationInput) {
        this.elements.enableModerateFatigueNotificationInput.checked = this.settings.enableModerateFatigueNotification !== false;
      }
      if (this.elements.enableHighFatigueNotificationInput) {
        this.elements.enableHighFatigueNotificationInput.checked = this.settings.enableHighFatigueNotification !== false;
      }
      if (this.elements.enableBreakNotificationInput) {
        this.elements.enableBreakNotificationInput.checked = this.settings.enableBreakNotification ?? this.settings.enable20MinNotification ?? true;
      }
      this.updateSliderDisplay();
    }
  }

  updateSliderDisplay() {
    this.elements.lowFatigueValueDisplay.textContent = this.elements.lowFatigueThresholdInput.value;
    this.elements.highFatigueValueDisplay.textContent = this.elements.highFatigueThresholdInput.value;
    if (this.elements.fatigueIntervalValueDisplay && this.elements.fatigueNotificationIntervalInput) {
      this.elements.fatigueIntervalValueDisplay.textContent = this.elements.fatigueNotificationIntervalInput.value;
    }
  }

  async saveSettings() {
    const newSettings = {
      lowFatigueThreshold: Number(this.elements.lowFatigueThresholdInput.value),
      highFatigueThreshold: Number(this.elements.highFatigueThresholdInput.value),
      fatigueNotificationIntervalMinutes: Number(this.elements.fatigueNotificationIntervalInput.value),
      enableModerateFatigueNotification: this.elements.enableModerateFatigueNotificationInput.checked,
      enableHighFatigueNotification: this.elements.enableHighFatigueNotificationInput.checked,
      enableBreakNotification: this.elements.enableBreakNotificationInput.checked,
    };

    try {
      console.log('[Extension] Saving settings:', newSettings);
      
      // Save to extension storage
      await chrome.storage.local.set({ extensionSettings: newSettings });
      console.log('[Extension] Saved to extensionSettings');
      
      // Also sync to website storage for two-way synchronization
      await chrome.storage.local.set({ websiteSettings: newSettings });
      console.log('[Extension] Saved to websiteSettings');
      
      this.settings = newSettings;
      this.showSuccess('Settings saved successfully!');
      this.toggleSettings();
      
      // Send message to website if it's open
      await this.syncSettingsToWebsite(newSettings);
    } catch (err) {
      console.error('[DevWell Popup] Failed to save settings:', err);
      this.showError('Failed to save settings');
    }
  }

  async syncSettingsToWebsite(settings) {
    try {
      console.log('[Extension] Syncing settings to website...');
      
      // Check if website is open in any tab
      const tabs = await chrome.tabs.query({
        url: ['http://localhost:5173/*', 'http://127.0.0.1:5173/*']
      });
      
      console.log('[Extension] Found website tabs:', tabs.length);
      
      if (tabs.length > 0) {
        // Send message to website to update settings
        for (const tab of tabs) {
          try {
            console.log('[Extension] Sending message to tab:', tab.id, tab.url);
            await chrome.tabs.sendMessage(tab.id, {
              action: 'syncSettings',
              settings: settings
            });
            console.log('[Extension] Settings synced to website tab:', tab.id);
          } catch (err) {
            console.warn('[Extension] Could not sync settings to tab:', tab.id, err);
          }
        }
      }
    } catch (err) {
      console.error('[Extension] Failed to sync settings to website:', err);
    }
  }

  showSuccess(message) {
    document.querySelector('.success-banner')?.remove();

    const banner = document.createElement('div');
    banner.className = 'success-banner';
    banner.textContent = message;

    document.querySelector('.container')?.prepend(banner);
    window.setTimeout(() => banner.remove(), 3000);
  }

  showError(message) {
    document.querySelector('.error-banner')?.remove();

    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = message;

    document.querySelector('.container')?.prepend(banner);
    window.setTimeout(() => banner.remove(), 3000);
  }

  // Guest Mode Methods
  async toggleGuestMode() {
    console.log('toggleGuestMode called, current state:', this.guestModeActive);
    this.guestModeActive = !this.guestModeActive;
    console.log('guestModeActive set to:', this.guestModeActive);
    
    try {
      await chrome.storage.local.set({ guestModeActive: this.guestModeActive });
      
      if (!this.guestModeActive && this.sessionActive) {
        // If exiting guest mode while session is active, stop the session
        await this.sendRuntimeMessage('requestStopSession');
      }
      
      this.updateUI();
    } catch (err) {
      console.error('Failed to toggle guest mode:', err);
    }
  }

  async openGuestAnalytics() {
    try {
      const analyticsUrl = chrome.runtime.getURL('guest-analytics.html');
      await chrome.tabs.create({ url: analyticsUrl });
    } catch (err) {
      console.error('Failed to open guest analytics:', err);
      this.showError('Failed to open analytics');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DevWellPopup();
});
