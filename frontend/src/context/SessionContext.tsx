import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { FatigueEngine } from '../lib/fatigueEngine';
import type { FatigueState, RestoredSessionData, SessionSummary } from '../lib/fatigueEngine';
import api from '../lib/api';
import { useAuth } from './AuthContext';
import {
  ACTIVE_SESSION_KEY,
  SESSION_DATA_KEY,
  EXTENSION_STATE_ATTRIBUTE,
  EXTENSION_COMMAND_ATTRIBUTE,
  SESSION_OWNER_KEY,
  SHARED_SESSION_KEY,
  SESSION_COMMAND_KEY,
  clearPersistedSession,
} from '../lib/extensionSync';
const TAB_ID_KEY = 'devwell_tab_id';
const OWNER_STALE_MS = 6000;
const EXTENSION_PING_MS = 1000;

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

interface SessionOwnerMeta {
  tabId: string;
  heartbeatAt: number;
}

interface SharedSessionSnapshot {
  ownerTabId: string;
  updatedAt: number;
  state: FatigueState;
  restoredData: RestoredSessionData;
}

interface SessionCommand {
  type: 'stop';
  requesterTabId: string;
  issuedAt: number;
}

interface SessionContextType {
  state: FatigueState;
  alerts: Alert[];
  sessionSummary: SessionSummary | null;
  saving: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isStarting: boolean;
  isSessionOwner: boolean;
  startSession: (visibleVideoEl?: HTMLVideoElement) => Promise<void>;
  stopSession: () => Promise<void>;
  dismissAlert: (id: number) => void;
  clearSummary: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getOrCreateTabId(): string {
  const existing = sessionStorage.getItem(TAB_ID_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID();
  sessionStorage.setItem(TAB_ID_KEY, next);
  return next;
}

function isOwnerAlive(owner: SessionOwnerMeta | null): boolean {
  return Boolean(owner && Date.now() - owner.heartbeatAt < OWNER_STALE_MS);
}

function buildRestoredData(state: FatigueState): RestoredSessionData {
  return {
    blinkCount: state.blinkCount,
    longClosureEvents: state.longClosureEvents,
    savedAt: Date.now(),
    durationAtSave: state.sessionDurationMinutes,
  };
}

function clearSharedSessionKeys(): void {
  clearPersistedSession();
  localStorage.removeItem(SHARED_SESSION_KEY);
  localStorage.removeItem(SESSION_OWNER_KEY);
  localStorage.removeItem(SESSION_COMMAND_KEY);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<FatigueState>(defaultState);
  const [externalState, setExternalState] = useState<FatigueState | null>(null);
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [saving, setSaving] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSessionOwner, setIsSessionOwner] = useState(false);
  const engineRef = useRef<FatigueEngine | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const alertIdRef = useRef(0);
  const restoreAttemptedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tabIdRef = useRef(getOrCreateTabId());
  const stateRef = useRef<FatigueState>(defaultState);
  const takeoverInFlightRef = useRef(false);
  const extensionCommandInFlightRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Clean up orphaned streams on mount (page reload)
  useEffect(() => {
    const active = localStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    
    // Wait for video element to be mounted
    const cleanupTimer = setTimeout(() => {
      if (!videoRef.current) return;
      
      // If there's no active session flag but video has a stream, clean it up
      if (!active && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }

      // If there's an active session but we're not the owner (page reload scenario),
      // clean up any leftover streams
      if (active && videoRef.current.srcObject) {
        const owner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);
        const isOwner = owner?.tabId === tabIdRef.current;
        
        if (!isOwner) {
          // We're not the owner, so clean up any orphaned stream
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }
      }
    }, 100);

    return () => clearTimeout(cleanupTimer);
  }, []);

  const playHighFatigueSound = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    setAlerts((prev) => [...prev.slice(-4), { id, type, message }]);

    const isFatigueNotification = type === 'fatigue_moderate' || type === 'fatigue_high';
    if (isFatigueNotification && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('DevWell AI Fatigue Alert', { body: message });
    }

    if (type === 'fatigue_high') {
      playHighFatigueSound();
    }

    setTimeout(() => {
      setAlerts((prev) => prev.filter((alert) => alert.id !== id));
    }, 8000);
  }, [playHighFatigueSound]);

  const persistSharedState = useCallback((nextState: FatigueState) => {
    const restoredData = buildRestoredData(nextState);
    const ownerMeta: SessionOwnerMeta = {
      tabId: tabIdRef.current,
      heartbeatAt: Date.now(),
    };
    const snapshot: SharedSessionSnapshot = {
      ownerTabId: tabIdRef.current,
      updatedAt: ownerMeta.heartbeatAt,
      state: nextState,
      restoredData,
    };

    localStorage.setItem(ACTIVE_SESSION_KEY, '1');
    localStorage.setItem(SESSION_DATA_KEY, JSON.stringify(restoredData));
    localStorage.setItem(SESSION_OWNER_KEY, JSON.stringify(ownerMeta));
    localStorage.setItem(SHARED_SESSION_KEY, JSON.stringify(snapshot));
  }, []);

  const claimOwnership = useCallback(() => {
    const currentOwner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);
    if (currentOwner && currentOwner.tabId !== tabIdRef.current && isOwnerAlive(currentOwner)) {
      return false;
    }

    localStorage.setItem(SESSION_OWNER_KEY, JSON.stringify({
      tabId: tabIdRef.current,
      heartbeatAt: Date.now(),
    } satisfies SessionOwnerMeta));

    return true;
  }, []);

  const releaseOwnership = useCallback(() => {
    const currentOwner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);
    if (currentOwner?.tabId === tabIdRef.current) {
      localStorage.removeItem(SESSION_OWNER_KEY);
    }
    setIsSessionOwner(false);
  }, []);

  const startOwnedSession = useCallback(async (restoredData?: RestoredSessionData) => {
    setSessionSummary(null);
    setAlerts([]);
    setIsStarting(true);

    const timeoutId = window.setTimeout(() => {
      handleAlert('error', 'Session initialization is taking too long. Please try again.');
      setIsStarting(false);
    }, 15000);

    if (!videoRef.current) {
      clearTimeout(timeoutId);
      handleAlert('error', 'Video element not available. Please refresh the page.');
      setIsStarting(false);
      releaseOwnership();
      return false;
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    try {
      const engine = new FatigueEngine(setState, handleAlert);
      engineRef.current = engine;
      setIsSessionOwner(true);
      await engine.start(videoRef.current, restoredData);
      persistSharedState({
        ...stateRef.current,
        isRunning: true,
      });
      clearTimeout(timeoutId);
      setIsStarting(false);
      return true;
    } catch (error) {
      clearTimeout(timeoutId);
      engineRef.current = null;
      releaseOwnership();
      handleAlert('error', getErrorMessage(error, 'Failed to start webcam. Please check camera permissions.'));
      return false;
    }
  }, [handleAlert, persistSharedState, releaseOwnership]);

  const stopOwnedSession = useCallback(async (shouldSave = true) => {
    if (!engineRef.current) return;

    const summary = engineRef.current.stop();
    engineRef.current = null;
    
    // Clean up the persistent video stream
    if (videoRef.current && videoRef.current.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    
    clearSharedSessionKeys();
    setState(defaultState);
    setSessionSummary(summary);
    setIsStarting(false);
    releaseOwnership();

    if (!shouldSave) {
      return;
    }

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
  }, [handleAlert, releaseOwnership]);

  const syncFromSharedSnapshot = useCallback(() => {
    const snapshot = readJson<SharedSessionSnapshot>(SHARED_SESSION_KEY);
    if (!snapshot) return false;

    setState(snapshot.state);
    return true;
  }, []);

  const startSession = useCallback(async (visibleVideoEl?: HTMLVideoElement) => {
    if (isStarting) return;

    if (extensionAvailable) {
      if (extensionCommandInFlightRef.current) return;
      extensionCommandInFlightRef.current = true;
      document.documentElement.setAttribute(
        EXTENSION_COMMAND_ATTRIBUTE,
        JSON.stringify({ type: 'start', requestedAt: Date.now() })
      );
      window.setTimeout(() => {
        extensionCommandInFlightRef.current = false;
      }, 2000);
      return;
    }

    const active = localStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    const owner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);

    if (active && owner && owner.tabId !== tabIdRef.current && isOwnerAlive(owner)) {
      setIsSessionOwner(false);
      syncFromSharedSnapshot();
      return;
    }

    if (!claimOwnership()) {
      setIsSessionOwner(false);
      syncFromSharedSnapshot();
      return;
    }

    const snapshot = readJson<SharedSessionSnapshot>(SHARED_SESSION_KEY);
    const restoredData = snapshot?.restoredData ?? readJson<RestoredSessionData>(SESSION_DATA_KEY) ?? undefined;
    const success = await startOwnedSession(restoredData);
    
    // Sync stream to visible video element if provided
    if (success && visibleVideoEl && videoRef.current?.srcObject) {
      visibleVideoEl.srcObject = videoRef.current.srcObject;
    }
  }, [claimOwnership, extensionAvailable, isStarting, startOwnedSession, syncFromSharedSnapshot]);

  const stopSession = useCallback(async () => {
    if (extensionAvailable) {
      if (extensionCommandInFlightRef.current) return;
      extensionCommandInFlightRef.current = true;
      document.documentElement.setAttribute(
        EXTENSION_COMMAND_ATTRIBUTE,
        JSON.stringify({ type: 'stop', requestedAt: Date.now() })
      );
      window.setTimeout(() => {
        extensionCommandInFlightRef.current = false;
      }, 2000);
      return;
    }

    if (isSessionOwner) {
      await stopOwnedSession();
      return;
    }

    if (!state.isRunning) return;

    localStorage.setItem(SESSION_COMMAND_KEY, JSON.stringify({
      type: 'stop',
      requesterTabId: tabIdRef.current,
      issuedAt: Date.now(),
    } satisfies SessionCommand));
  }, [extensionAvailable, isSessionOwner, state.isRunning, stopOwnedSession]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return;

      if (event.key === SHARED_SESSION_KEY && !isSessionOwner) {
        if (event.newValue) {
          const snapshot = readJson<SharedSessionSnapshot>(SHARED_SESSION_KEY);
          if (snapshot) {
            setState(snapshot.state);
          }
        } else {
          setState(defaultState);
        }
      }

      if (event.key === ACTIVE_SESSION_KEY && event.newValue !== '1' && !isSessionOwner) {
        setState(defaultState);
        setSessionSummary(null);
      }

      if (event.key === SESSION_COMMAND_KEY && isSessionOwner && event.newValue) {
        const command = readJson<SessionCommand>(SESSION_COMMAND_KEY);
        if (command?.type === 'stop') {
          void stopOwnedSession();
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [isSessionOwner, stopOwnedSession]);

  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;

    if (extensionAvailable) {
      return;
    }

    const active = localStorage.getItem(ACTIVE_SESSION_KEY) === '1';
    if (!active) return;

    const owner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);
    const hasOwnerElsewhere = owner && owner.tabId !== tabIdRef.current && isOwnerAlive(owner);

    if (syncFromSharedSnapshot() && hasOwnerElsewhere) {
      setIsSessionOwner(false);
      handleAlert('info', 'This tab is following your active session from another DevWell tab.');
      return;
    }

    // Page reload scenario: we were the owner but page was reloaded
    // The session data exists but the FatigueEngine instance is lost
    // We need to clean up and let the user restart manually
    const snapshot = readJson<SharedSessionSnapshot>(SHARED_SESSION_KEY);
    const restoredData = snapshot?.restoredData ?? readJson<RestoredSessionData>(SESSION_DATA_KEY) ?? undefined;

    if (restoredData) {
      // Clean up orphaned session - user needs to restart manually
      handleAlert('info', 'Previous session was interrupted. Please start a new session.');
      clearSharedSessionKeys();
      setState(defaultState);
      setIsSessionOwner(false);
    }
  }, [extensionAvailable, handleAlert, syncFromSharedSnapshot]);

  useEffect(() => {
    if (!isSessionOwner || !state.isRunning || extensionAvailable) return;

    persistSharedState(stateRef.current);
    const intervalId = window.setInterval(() => {
      persistSharedState(stateRef.current);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [extensionAvailable, isSessionOwner, state.isRunning, persistSharedState]);

  useEffect(() => {
    if (extensionAvailable) return;
    if (!state.isRunning || isSessionOwner || isStarting || !user) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || takeoverInFlightRef.current) {
        return;
      }

      const owner = readJson<SessionOwnerMeta>(SESSION_OWNER_KEY);
      if (owner && isOwnerAlive(owner)) {
        return;
      }

      const snapshot = readJson<SharedSessionSnapshot>(SHARED_SESSION_KEY);
      if (!snapshot?.restoredData) {
        return;
      }

      if (!claimOwnership()) {
        return;
      }

      takeoverInFlightRef.current = true;
      handleAlert('info', 'This tab is resuming your active session...');
      void startOwnedSession(snapshot.restoredData).finally(() => {
        takeoverInFlightRef.current = false;
      });
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [claimOwnership, handleAlert, isSessionOwner, isStarting, startOwnedSession, state.isRunning, user]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (extensionAvailable) return;
      if (!isSessionOwner || !stateRef.current.isRunning) return;

      localStorage.setItem(SESSION_DATA_KEY, JSON.stringify(buildRestoredData(stateRef.current)));
      localStorage.removeItem(SESSION_OWNER_KEY);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSessionOwner]);

  useEffect(() => {
    if (user) return;

    if (engineRef.current) {
      void stopOwnedSession(false);
    } else {
      clearSharedSessionKeys();
      setState(defaultState);
      setIsSessionOwner(false);
      setIsStarting(false);
    }

    setAlerts([]);
    setSessionSummary(null);
  }, [stopOwnedSession, user]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const applyExternalState = (raw: string | null) => {
      if (!raw) {
        setExtensionAvailable(false);
        setExternalState(null);
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (parsed?.source === 'extension' && parsed?.engine === 'extension') {
          setExtensionAvailable(true);
          setExternalState(parsed.sessionData ?? null);
          if (parsed.sessionActive) {
            setIsSessionOwner(false);
          }
          return;
        }
        setExtensionAvailable(false);
        setExternalState(null);
      } catch {
        setExtensionAvailable(false);
        setExternalState(null);
      }
    };

    applyExternalState(document.documentElement.getAttribute(EXTENSION_STATE_ATTRIBUTE));

    const observer = new MutationObserver(() => {
      applyExternalState(document.documentElement.getAttribute(EXTENSION_STATE_ATTRIBUTE));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [EXTENSION_STATE_ATTRIBUTE],
    });

    const pingId = window.setInterval(() => {
      if (extensionAvailable) {
        document.documentElement.setAttribute(
          EXTENSION_COMMAND_ATTRIBUTE,
          JSON.stringify({ type: 'ping', requestedAt: Date.now() })
        );
      }
    }, EXTENSION_PING_MS);

    return () => {
      observer.disconnect();
      window.clearInterval(pingId);
    };
  }, [extensionAvailable]);

  const dismissAlert = useCallback((id: number) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  const clearSummary = useCallback(() => setSessionSummary(null), []);

  const effectiveState = externalState ?? state;

  return (
    <SessionContext.Provider value={{
      state: effectiveState,
      alerts,
      sessionSummary,
      saving,
      videoRef,
      isStarting,
      isSessionOwner: !extensionAvailable && isSessionOwner,
      startSession,
      stopSession,
      dismissAlert,
      clearSummary,
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
