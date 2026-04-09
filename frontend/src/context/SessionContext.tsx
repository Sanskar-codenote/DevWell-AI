import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { FatigueEngine } from '../lib/fatigueEngine';
import type { FatigueState } from '../lib/fatigueEngine';
import api from '../lib/api';

const ACTIVE_SESSION_KEY = 'devwell_active_session';
const SESSION_DATA_KEY = 'devwell_session_data';

const defaultState: FatigueState = {
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
  const audioContextRef = useRef<AudioContext | null>(null);

  const playHighFatigueSound = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = audioContextRef.current ?? new AudioCtx();
    audioContextRef.current = ctx;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const tones = [880, 660, 880];
    tones.forEach((freq, idx) => {
      const start = now + idx * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    });
  }, []);

  const handleAlert = useCallback((type: string, message: string) => {
    const id = ++alertIdRef.current;
    setAlerts(prev => [...prev.slice(-4), { id, type, message }]);
    const isFatigueNotification = type === 'fatigue_moderate' || type === 'fatigue_high';
    if (isFatigueNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('DevWell AI Fatigue Alert', { body: message });
    }
    if (type === 'fatigue_high') {
      playHighFatigueSound();
    }
    setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 8000);
  }, [playHighFatigueSound]);

  const startSession = useCallback(async () => {
    console.log('[Session] Starting session...');
    setSessionSummary(null);
    setAlerts([]);
    setIsStarting(true);
    
    // Check for saved session data to restore
    let restoredSessionData = null;
    const savedSessionData = sessionStorage.getItem(SESSION_DATA_KEY);
    console.log('[Session] Checking for saved data...', savedSessionData ? 'FOUND' : 'NOT FOUND');
    
    if (savedSessionData) {
      try {
        restoredSessionData = JSON.parse(savedSessionData);
        console.log('[Session] Parsed saved session data:', restoredSessionData);
      } catch (e) {
        console.error('[Session] Failed to parse saved session data:', e);
      }
    }
    
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
      await engine.start(videoRef.current, restoredSessionData);
      console.log('Engine started successfully');
      
      // Mark session as active
      sessionStorage.setItem(ACTIVE_SESSION_KEY, '1');
      
      // Clear saved session data after successful restore
      if (restoredSessionData) {
        sessionStorage.removeItem(SESSION_DATA_KEY);
        console.log('[Session] Cleared saved session data after restore');
      }
      
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
    
    // Clear session flags and saved data
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    sessionStorage.removeItem(SESSION_DATA_KEY);
    
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
      // Don't clear session on refresh/close - let it persist for restoration
      // Only clear when explicitly stopping the session
    };
  }, []);

  // Warn user before closing/refreshing during active session AND save data immediately
  useEffect(() => {
    if (!state.isRunning) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Save current session state immediately before unload
      const sessionData = {
        blinkCount: state.blinkCount,
        longClosureEvents: state.longClosureEvents,
        blinkHistory: [],
        savedAt: Date.now(),
        durationAtSave: state.sessionDurationMinutes,
      };
      sessionStorage.setItem(SESSION_DATA_KEY, JSON.stringify(sessionData));
      console.log(`[Session] Saved state before unload: ${state.blinkCount} blinks, ${state.sessionDurationMinutes.toFixed(1)}min`);
      
      // Show browser warning
      e.preventDefault();
      e.returnValue = 'You have an active session. Your progress will be saved and restored when you return.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isRunning, state.blinkCount, state.longClosureEvents, state.sessionDurationMinutes]);

  // Restore active session on refresh within the same tab.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    const hasActiveSession = sessionStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    const hasSessionData = sessionStorage.getItem(SESSION_DATA_KEY);
    
    console.log('[Session] === Restoration Check ===');
    console.log('[Session] hasActiveSession:', hasActiveSession);
    console.log('[Session] hasSessionData:', hasSessionData);
    
    if (!hasActiveSession && !hasSessionData) {
      console.log('[Session] No active session to restore');
      return;
    }
    
    if (hasSessionData) {
      try {
        const parsedData = JSON.parse(hasSessionData);
        console.log('[Session] Saved data details:', parsedData);
      } catch (e) {
        console.error('[Session] Failed to parse saved data:', e);
      }
    }
    
    console.log('[Session] Detected active session, attempting to restore...');
    
    // Show a brief message that session is being restored
    if (hasSessionData) {
      handleAlert('info', 'Restoring your previous session...');
    }
    
    void startSession();
  }, [startSession, handleAlert]);

  const dismissAlert = useCallback((id: number) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const clearSummary = useCallback(() => setSessionSummary(null), []);

  // Periodically save session data to sessionStorage for recovery
  useEffect(() => {
    if (!state.isRunning) return;

    const saveInterval = setInterval(() => {
      const sessionData = {
        blinkCount: state.blinkCount,
        longClosureEvents: state.longClosureEvents,
        blinkHistory: [], // We'll recalculate this on restore
        // Store the actual session start time (engine tracks this internally)
        // We need to get this from the engine, but for now we'll calculate it
        // This will be accurate enough for restoration purposes
        savedAt: Date.now(),
        durationAtSave: state.sessionDurationMinutes,
      };
      sessionStorage.setItem(SESSION_DATA_KEY, JSON.stringify(sessionData));
      console.log(`[Session] Auto-saved: ${state.blinkCount} blinks, ${state.sessionDurationMinutes.toFixed(1)}min`);
    }, 5000); // Save every 5 seconds

    return () => clearInterval(saveInterval);
  }, [state.isRunning, state.blinkCount, state.longClosureEvents, state.sessionDurationMinutes]);

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
