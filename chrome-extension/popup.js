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
    
    this.elements.sessionBtn = document.getElementById('sessionBtn');
    this.elements.statusIndicator = document.getElementById('statusIndicator');
    this.elements.sessionTime = document.getElementById('sessionTime');
    this.elements.blinkRate = document.getElementById('blinkRate');
    this.elements.totalBlinks = document.getElementById('totalBlinks');
    this.elements.drowsyEvents = document.getElementById('drowsyEvents');
    this.elements.fatigueScore = document.getElementById('fatigueScore');
    this.elements.fatigueLevel = document.getElementById('fatigueLevel');
    this.elements.progressFill = document.getElementById('progressFill');
    this.elements.alertsList = document.getElementById('alertsList');
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

    document.getElementById('openDashboardBtn')?.addEventListener('click', () => {
      void this.openAppRoute('/dashboard');
    });

    document.getElementById('viewAnalyticsBtn')?.addEventListener('click', () => {
      void this.openAppRoute('/analytics');
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

      this.updateUI();
    });
  }

  async loadState() {
    const result = await chrome.storage.local.get([
      'sessionActive',
      'sessionData',
      'alerts',
      'extensionAuth',
    ]);

    this.sessionActive = Boolean(result.sessionActive);
    this.sessionData = result.sessionData ?? null;
    this.alerts = Array.isArray(result.alerts) ? result.alerts : [];
    
    const auth = result.extensionAuth;
    this.isLoggedIn = Boolean(auth?.token);
    this.userEmail = auth?.email ?? null;
  }

  async handleLogin() {
    const email = this.elements.emailInput.value;
    const password = this.elements.passwordInput.value;

    if (!email || !password) {
      this.showError('Please enter both email and password');
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
        }
      });

      this.isLoggedIn = true;
      this.userEmail = email;
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
      await chrome.runtime.sendMessage({ action: 'requestStopSession' });
    }
    await chrome.storage.local.remove('extensionAuth');
    this.isLoggedIn = false;
    this.userEmail = null;
    this.updateUI();
  }

  async handleSessionAction() {
    if (!this.isLoggedIn) return;

    const actionType = this.sessionActive ? 'endSession' : 'startSession';

    if (actionType === 'startSession') {
      const response = await chrome.runtime.sendMessage({ action: 'requestStartSession' });
      if (response && !response.success) {
        this.showError(response.error || 'Failed to start session');
        return;
      }
    } else {
      await chrome.runtime.sendMessage({ action: 'requestStopSession' });
    }
  }

  updateUI() {
    if (!this.isLoggedIn) {
      this.elements.loginSection.style.display = 'block';
      this.elements.dashboardSection.style.display = 'none';
      this.elements.statusIndicator.classList.remove('active');
      this.elements.statusIndicator.querySelector('.status-text').textContent = 'Logged Out';
      return;
    }

    this.elements.loginSection.style.display = 'none';
    this.elements.dashboardSection.style.display = 'block';

    const statusText = this.elements.statusIndicator?.querySelector('.status-text');
    if (this.sessionActive) {
      this.elements.statusIndicator?.classList.add('active');
      if (statusText) statusText.textContent = 'Monitoring';
    } else {
      this.elements.statusIndicator?.classList.remove('active');
      if (statusText) statusText.textContent = 'Ready';
    }

    if (this.elements.sessionBtn) {
      this.elements.sessionBtn.textContent = this.sessionActive ? 'End Session' : 'Start Session';
      this.elements.sessionBtn.className = this.sessionActive ? 'btn btn-outline' : 'btn btn-primary';
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
      const typeClass = alert.type === 'fatigue_high' ? 'danger' : alert.type === 'fatigue_moderate' || alert.type === 'break' ? 'warning' : '';
      return `
        <div class="alert-item ${typeClass}">
          <div>${alert.message}</div>
          <div class="alert-time">${new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      `;
    }).join('');
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
}

document.addEventListener('DOMContentLoaded', () => {
  new DevWellPopup();
});
