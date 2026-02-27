import { createContext, useContext, useState, useRef, useCallback, ReactNode } from 'react';
import { FatigueEngine } from '../lib/fatigueEngine';
import type { FatigueState } from '../lib/fatigueEngine';
import api from '../lib/api';

const defaultState: FatigueState = {
  blinkCount: 0,
  blinksPerMinute: 0,
  fatigueScore: 0,
  fatigueLevel: 'Fresh',
  longClosureEvents: 0,
  eyesOpen: true,
  sessionDurationMinutes: 0,
  isRunning: false,
};

interface Alert {
  id: number;
  type: string;
  message: string;
}

interface SessionContextType {
  state: FatigueState;
  alerts: Alert[];
  sessionSummary: any;
  saving: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  dismissAlert: (id: number) => void;
  clearSummary: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FatigueState>(defaultState);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [saving, setSaving] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<any>(null);
  const engineRef = useRef<FatigueEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const alertIdRef = useRef(0);

  const handleAlert = useCallback((type: string, message: string) => {
    const id = ++alertIdRef.current;
    setAlerts(prev => [...prev.slice(-4), { id, type, message }]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('DevWell AI', { body: message });
    }
    setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 8000);
  }, []);

  const startSession = useCallback(async () => {
    setSessionSummary(null);
    setAlerts([]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const engine = new FatigueEngine(setState, handleAlert);
    engineRef.current = engine;
    try {
      await engine.start(videoRef.current!);
    } catch (err: any) {
      handleAlert('error', err.message || 'Failed to start webcam');
    }
  }, [handleAlert]);

  const stopSession = useCallback(async () => {
    if (!engineRef.current) return;
    const summary = engineRef.current.stop();
    engineRef.current = null;
    setState(defaultState);
    setSessionSummary(summary);

    setSaving(true);
    try {
      await api.post('/sessions', {
        session_date: summary.sessionDate,
        duration_minutes: summary.sessionDurationMinutes,
        avg_blink_rate: summary.blinksPerMinute,
        fatigue_score: summary.fatigueScore,
        long_closure_events: summary.longClosureEvents,
      });
    } catch {
      handleAlert('error', 'Failed to save session data');
    } finally {
      setSaving(false);
    }
  }, [handleAlert]);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearSummary = useCallback(() => setSessionSummary(null), []);

  return (
    <SessionContext.Provider value={{
      state, alerts, sessionSummary, saving, videoRef,
      startSession, stopSession, dismissAlert, clearSummary,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be inside SessionProvider');
  return ctx;
}
