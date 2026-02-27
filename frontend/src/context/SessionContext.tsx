import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { FatigueEngine } from '../lib/fatigueEngine';
import type { FatigueState } from '../lib/fatigueEngine';
import api from '../lib/api';

const ACTIVE_SESSION_KEY = 'devwell_active_session';

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
  isStarting: boolean;
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
  const [isStarting, setIsStarting] = useState(false);
  const engineRef = useRef<FatigueEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const alertIdRef = useRef(0);
  const restoreAttemptedRef = useRef(false);

  const handleAlert = useCallback((type: string, message: string) => {
    const id = ++alertIdRef.current;
    setAlerts(prev => [...prev.slice(-4), { id, type, message }]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('DevWell AI', { body: message });
    }
    setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 8000);
  }, []);

  const startSession = useCallback(async () => {
    console.log('Starting session...');
    setSessionSummary(null);
    setAlerts([]);
    setIsStarting(true);
    
    // Add timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      console.error('Session start timeout - taking too long');
      handleAlert('error', 'Session initialization is taking too long. Please try again.');
      setIsStarting(false);
    }, 15000); // 15 second timeout
    
    // Check if video ref is available
    if (!videoRef.current) {
      console.error('Video element not available');
      clearTimeout(timeoutId);
      handleAlert('error', 'Video element not available. Please refresh the page.');
      setIsStarting(false);
      return;
    }
    
    console.log('Video element available:', videoRef.current);
    
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    
    try {
      console.log('Creating fatigue engine...');
      const engine = new FatigueEngine(setState, handleAlert);
      engineRef.current = engine;
      console.log('Starting engine with video element...');
      await engine.start(videoRef.current);
      console.log('Engine started successfully');
      sessionStorage.setItem(ACTIVE_SESSION_KEY, '1');
      clearTimeout(timeoutId);
      setIsStarting(false);
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error('Failed to start session:', err);
      console.error('Error stack:', err.stack);
      handleAlert('error', err.message || 'Failed to start webcam. Please check camera permissions.');
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      setIsStarting(false);
    }
  }, [handleAlert]);

  const stopSession = useCallback(async () => {
    if (!engineRef.current) return;
    const summary = engineRef.current.stop();
    engineRef.current = null;
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    setState(defaultState);
    setSessionSummary(summary);
    setIsStarting(false);

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

  // Cleanup effect to ensure proper cleanup when component unmounts
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    };
  }, []);

  // Restore active session on refresh within the same tab.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    if (sessionStorage.getItem(ACTIVE_SESSION_KEY) !== '1') return;
    void startSession();
  }, [startSession]);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearSummary = useCallback(() => setSessionSummary(null), []);

  return (
    <SessionContext.Provider value={{
      state, alerts, sessionSummary, saving, videoRef, isStarting,
      startSession, stopSession, dismissAlert, clearSummary,
    }}>
      {children}
      <video
        ref={videoRef}
        playsInline
        muted
        aria-hidden="true"
        style={{
          position: 'fixed',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          left: '-9999px',
          top: '-9999px',
        }}
      />
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be inside SessionProvider');
  return ctx;
}
