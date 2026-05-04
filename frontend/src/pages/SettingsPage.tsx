import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Settings, Save, AlertCircle } from 'lucide-react';

export interface SettingsData {
  lowFatigueThreshold: number;
  highFatigueThreshold: number;
  fatigueNotificationIntervalMinutes: number;
  enableModerateFatigueNotification: boolean;
  enableHighFatigueNotification: boolean;
  enableBreakNotification: boolean;
  lowBlinkRate: number;
}

// Chrome extension types
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (message: unknown) => Promise<unknown>;
        onMessage?: {
          addListener: (callback: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void) => void;
          removeListener: (callback: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => void) => void;
        };
      };
      storage?: {
        local?: {
          set: (data: Record<string, unknown>) => Promise<void>;
        };
      };
    };
  }
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [lowFatigueThreshold, setLowFatigueThreshold] = useState<number>(50);
  const [highFatigueThreshold, setHighFatigueThreshold] = useState<number>(80);
  const [fatigueNotificationIntervalMinutes, setFatigueNotificationIntervalMinutes] = useState<number>(60);
  const [lowBlinkRate, setLowBlinkRate] = useState<number>(15);
  const [enableModerateFatigueNotification, setEnableModerateFatigueNotification] = useState<boolean>(true);
  const [enableHighFatigueNotification, setEnableHighFatigueNotification] = useState<boolean>(true);
  const [enableBreakNotification, setEnableBreakNotification] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load user settings from localStorage or API
    const loadSettings = async () => {
      try {
        // Try to load from localStorage first
        const savedSettings = localStorage.getItem('userSettings');
        if (savedSettings) {
          const settings = JSON.parse(savedSettings);
          setLowFatigueThreshold(settings.lowFatigueThreshold || 50);
          setHighFatigueThreshold(settings.highFatigueThreshold || 80);
          setFatigueNotificationIntervalMinutes(settings.fatigueNotificationIntervalMinutes || 60);
          setLowBlinkRate(settings.lowBlinkRate || 15);
          setEnableModerateFatigueNotification(settings.enableModerateFatigueNotification !== false);
          setEnableHighFatigueNotification(settings.enableHighFatigueNotification !== false);
          setEnableBreakNotification(
            settings.enableBreakNotification ?? settings.enable20MinNotification ?? true
          );
        }
        
        // TODO: Load from backend API if available
        // const response = await fetch('/api/v1/settings');
        // const data = await response.json();
        // if (response.ok) {
        //   setLowFatigueThreshold(data.lowFatigueThreshold || 50);
        //   setHighFatigueThreshold(data.highFatigueThreshold || 80);
        // }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    
    void loadSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    
    try {
      const settings = {
        userId: user?.id,
        lowFatigueThreshold,
        highFatigueThreshold,
        fatigueNotificationIntervalMinutes,
        lowBlinkRate,
        enableModerateFatigueNotification,
        enableHighFatigueNotification,
        enableBreakNotification,
        updatedAt: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('userSettings', JSON.stringify(settings));
      
      // TODO: Save to backend API
      // const response = await fetch('/api/v1/settings', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(settings)
      // });
      
      // if (!response.ok) {
      //   throw new Error('Failed to save settings');
      // }
      
      // Sync to chrome extension if available
      await syncSettingsToExtension(settings);
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const syncSettingsToExtension = async (settings: SettingsData) => {
    try {
      // Use the DOM-based bridge for cross-browser compatibility (works in Firefox/Safari)
      document.documentElement.setAttribute('data-devwell-extension-command', JSON.stringify({
        type: 'syncSettings',
        settings: settings
      }));

      // Fallback: Also try direct message if available (Chrome legacy)
      if (window.chrome?.runtime?.sendMessage) {
        try {
          await window.chrome.runtime.sendMessage({
            action: 'syncWebsiteSettings',
            settings: settings
          });
        } catch {
          // Handled by DOM bridge
        }
      }
    } catch (err) {
      console.warn('Could not sync settings to extension:', err);
    }
  };

  // Listen for settings changes from extension
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // Only accept messages from our origin and with the expected type
      if (event.data?.type === 'DEVWELL_SETTINGS_SYNC') {
        setLowFatigueThreshold(event.data.settings.lowFatigueThreshold);
        setHighFatigueThreshold(event.data.settings.highFatigueThreshold);
        setFatigueNotificationIntervalMinutes(event.data.settings.fatigueNotificationIntervalMinutes ?? 60);
        setLowBlinkRate(event.data.settings.lowBlinkRate ?? 15);
        setEnableModerateFatigueNotification(event.data.settings.enableModerateFatigueNotification !== false);
        setEnableHighFatigueNotification(event.data.settings.enableHighFatigueNotification !== false);
        setEnableBreakNotification(
          event.data.settings.enableBreakNotification ?? event.data.settings.enable20MinNotification ?? true
        );
      }
    };

    window.addEventListener('message', handleWindowMessage);

    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, []);

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center">
            <Settings className="h-5 w-5 text-slate-950" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
            <p className="text-sm text-slate-400">Customize your DevWell experience</p>
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-xl p-6 border border-white/5">
          <div className="space-y-6">
            {/* Low Fatigue Notification Threshold */}
            <div>
              <label htmlFor="lowFatigueThreshold" className="block text-sm font-medium text-slate-300 mb-2">
                Low Fatigue Notification Threshold (Warning)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  id="lowFatigueThreshold"
                  min="10"
                  max="90"
                  value={lowFatigueThreshold}
                  onChange={(e) => setLowFatigueThreshold(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-lg font-medium text-yellow-400 w-12 text-center">{lowFatigueThreshold}%</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Receive warning notifications when fatigue score exceeds this value.
              </p>
            </div>

            {/* High Fatigue Notification Threshold */}
            <div>
              <label htmlFor="highFatigueThreshold" className="block text-sm font-medium text-slate-300 mb-2">
                High Fatigue Notification Threshold (Alert with Sound)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  id="highFatigueThreshold"
                  min="50"
                  max="100"
                  value={highFatigueThreshold}
                  onChange={(e) => setHighFatigueThreshold(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-lg font-medium text-red-400 w-12 text-center">{highFatigueThreshold}%</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Receive urgent alerts with sound when fatigue score exceeds this value.
              </p>
            </div>

            {/* Fatigue Alert Interval */}
            <div>
              <label htmlFor="fatigueNotificationInterval" className="block text-sm font-medium text-slate-300 mb-2">
                Fatigue Alert Cooldown Interval
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  id="fatigueNotificationInterval"
                  min="5"
                  max="180"
                  step="5"
                  value={fatigueNotificationIntervalMinutes}
                  onChange={(e) => setFatigueNotificationIntervalMinutes(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-lg font-medium text-cyan-400 w-16 text-center">
                  {fatigueNotificationIntervalMinutes}m
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Minimum time between repeated fatigue notifications.
              </p>
            </div>

            {/* Low Blink Rate Setting */}
            <div>
              <label htmlFor="lowBlinkRate" className="block text-sm font-medium text-slate-300 mb-2">
                Low Blink Rate Threshold (Blinks/min)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  id="lowBlinkRate"
                  min="5"
                  max="30"
                  step="1"
                  value={lowBlinkRate}
                  onChange={(e) => setLowBlinkRate(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="text-lg font-medium text-emerald-400 w-12 text-center">{lowBlinkRate}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                A blink rate below this value will contribute to your fatigue score. Normal range is usually 15-20 BPM.
              </p>
            </div>

            {/* Notification Toggles */}
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label htmlFor="moderateFatigueNotification" className="block text-sm font-medium text-slate-300 mb-2">
                  Moderate Fatigue Notifications
                </label>
                <p className="text-xs text-slate-500">
                  Notify when score crosses your warning threshold.
                </p>
              </div>
              <div className="flex items-center h-5">
                <input
                  id="moderateFatigueNotification"
                  type="checkbox"
                  checked={enableModerateFatigueNotification}
                  onChange={(e) => setEnableModerateFatigueNotification(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-700 text-emerald-400 focus:ring-emerald-400 focus:ring-2"
                />
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label htmlFor="highFatigueNotification" className="block text-sm font-medium text-slate-300 mb-2">
                  High Fatigue Notifications
                </label>
                <p className="text-xs text-slate-500">
                  Notify when score crosses your critical threshold.
                </p>
              </div>
              <div className="flex items-center h-5">
                <input
                  id="highFatigueNotification"
                  type="checkbox"
                  checked={enableHighFatigueNotification}
                  onChange={(e) => setEnableHighFatigueNotification(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-700 text-emerald-400 focus:ring-emerald-400 focus:ring-2"
                />
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-1">
                <label htmlFor="breakNotification" className="block text-sm font-medium text-slate-300 mb-2">
                  Break Reminder Notifications
                </label>
                <p className="text-xs text-slate-500">
                  Send periodic break reminders (20-minute rule).
                </p>
              </div>
              <div className="flex items-center h-5">
                <input
                  id="breakNotification"
                  type="checkbox"
                  checked={enableBreakNotification}
                  onChange={(e) => setEnableBreakNotification(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-700 text-emerald-400 focus:ring-emerald-400 focus:ring-2"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/5 flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {saveSuccess && (
            <div className="mt-4 p-3 bg-emerald-500/15 rounded-lg flex items-center gap-2 text-emerald-400 text-sm">
              <span className="h-2 w-2 bg-emerald-400 rounded-full"></span>
              Settings saved successfully!
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-500/15 rounded-lg flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
