import { useEffect, useRef } from 'react';
import { Play, Square, Eye, EyeOff, Clock, AlertTriangle, Zap, Activity, X } from 'lucide-react';
import { useSession } from '../context/SessionContext';

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const s = Math.floor((minutes * 60) % 60);
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}

function getFatigueColor(score: number): string {
  if (score <= 40) return 'text-emerald-400';
  if (score <= 70) return 'text-amber-400';
  return 'text-red-400';
}

function getFatigueBg(score: number): string {
  if (score <= 40) return 'from-emerald-500/20 to-emerald-500/5';
  if (score <= 70) return 'from-amber-500/20 to-amber-500/5';
  return 'from-red-500/20 to-red-500/5';
}

function getFatigueRingColor(score: number): string {
  if (score <= 40) return '#34d399';
  if (score <= 70) return '#fbbf24';
  return '#f87171';
}

export default function DashboardPage() {
  const {
    state, alerts, sessionSummary, saving, videoRef, isStarting,
    startSession, stopSession, dismissAlert, clearSummary,
  } = useSession();
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const preview = previewVideoRef.current;
    const processingVideo = videoRef.current;
    if (!preview || !processingVideo) return;

    if (!state.isRunning) {
      preview.srcObject = null;
      return;
    }

    if (preview.srcObject !== processingVideo.srcObject) {
      preview.srcObject = processingVideo.srcObject;
    }

    void preview.play().catch(() => {
      // Playback can fail transiently during route transitions; session processing continues.
    });
  }, [state.isRunning, videoRef]);

  const circumference = 2 * Math.PI * 54;
  const strokeOffset = circumference - (state.fatigueScore / 100) * circumference;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time fatigue monitoring</p>
        </div>
        {!state.isRunning ? (
          <button
            onClick={startSession}
            disabled={isStarting}
            className={`flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-semibold rounded-xl transition-all text-sm cursor-pointer ${
              isStarting ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            {isStarting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-950"></div>
                Starting...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Start Session
              </>
            )}
          </button>
        ) : (
          <button
            onClick={stopSession}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 font-semibold rounded-xl transition-all text-sm cursor-pointer"
          >
            <Square className="h-4 w-4" />
            End Session
          </button>
        )}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium animate-pulse ${
                alert.type === 'fatigue_high'
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : alert.type === 'fatigue_moderate' || alert.type === 'break'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {alert.message}
              </div>
              <button onClick={() => dismissAlert(alert.id)} className="ml-4 shrink-0 hover:opacity-70">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Session Summary Modal */}
      {sessionSummary && (
        <div className="mb-6 bg-gradient-to-r from-slate-800/80 to-slate-800/40 border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Session Complete</h3>
            <button onClick={clearSummary} className="text-slate-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Duration</p>
              <p className="text-lg font-bold text-white">{formatDuration(sessionSummary.sessionDurationMinutes)}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Fatigue Score</p>
              <p className={`text-lg font-bold ${getFatigueColor(sessionSummary.fatigueScore)}`}>{sessionSummary.fatigueScore}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Total Blinks</p>
              <p className="text-lg font-bold text-white">{sessionSummary.blinkCount}</p>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400 mb-1">Closure Events</p>
              <p className="text-lg font-bold text-amber-400">{sessionSummary.longClosureEvents}</p>
            </div>
          </div>
          {saving && <p className="text-xs text-slate-500 mt-3 text-center">Saving session data...</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Webcam + Fatigue Ring */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Webcam Feed */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5 flex flex-col">
            <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4" /> Camera Feed
            </h3>
            <div className="relative flex-1 min-h-[240px] bg-black/40 rounded-xl overflow-hidden flex items-center justify-center">
              <video
                ref={previewVideoRef}
                className={`w-full h-full object-cover rounded-xl ${state.isRunning ? 'block' : 'hidden'}`}
                playsInline
                muted
                style={{ transform: 'scaleX(-1)' }}
              />
              {!state.isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 rounded-xl z-10">
                  <EyeOff className="h-10 w-10 text-slate-600 mb-3" />
                  <p className="text-sm text-slate-500">Camera inactive</p>
                  <p className="text-xs text-slate-600 mt-1">Start a session to begin monitoring</p>
                </div>
              )}
              {state.isRunning && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur px-2.5 py-1 rounded-lg z-10">
                  <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs text-white font-medium">LIVE</span>
                </div>
              )}
            </div>
          </div>

          {/* Fatigue Score Ring */}
          <div className={`bg-gradient-to-b ${getFatigueBg(state.fatigueScore)} border border-white/5 rounded-2xl p-5 flex flex-col items-center justify-center`}>
            <h3 className="text-sm font-medium text-slate-400 mb-4">Fatigue Score</h3>
            <div className="relative">
              <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                <circle
                  cx="60" cy="60" r="54" fill="none"
                  stroke={getFatigueRingColor(state.fatigueScore)}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-3xl font-bold ${getFatigueColor(state.fatigueScore)}`}>
                  {state.fatigueScore}
                </span>
                <span className="text-xs text-slate-400 mt-0.5">/ 100</span>
              </div>
            </div>
            <div className={`mt-4 px-3 py-1 rounded-full text-xs font-semibold ${
              state.fatigueLevel === 'Fresh' ? 'bg-emerald-500/20 text-emerald-400' :
              state.fatigueLevel === 'Moderate Fatigue' ? 'bg-amber-500/20 text-amber-400' :
              'bg-red-500/20 text-red-400'
            }`}>
              {state.fatigueLevel}
            </div>
          </div>
        </div>

        {/* Stats Panel */}
        <div className="flex flex-col gap-4">
          {/* Timer */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-slate-400 mb-3">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">Session Time</span>
            </div>
            <p className="text-2xl font-bold text-white font-mono">
              {formatDuration(state.sessionDurationMinutes)}
            </p>
          </div>

          {/* Blink Rates */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-slate-400 mb-3">
              <Eye className="h-4 w-4" />
              <span className="text-sm font-medium">Blink Rates</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Current (60s)</p>
                <div className="flex items-baseline gap-1.5">
                  <p className={`text-xl font-bold ${state.currentBlinkRate < 8 && state.isRunning ? 'text-red-400' : 'text-white'}`}>
                    {state.currentBlinkRate}
                  </p>
                  <span className="text-xs text-slate-500">/min</span>
                </div>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">Session Avg</p>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-xl font-bold text-white">{state.sessionAvgBlinkRate}</p>
                  <span className="text-xs text-slate-500">/min</span>
                </div>
              </div>
            </div>
            <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  state.currentBlinkRate >= 15 ? 'bg-emerald-400' :
                  state.currentBlinkRate >= 8 ? 'bg-amber-400' : 'bg-red-400'
                }`}
                style={{ width: `${Math.min(100, (state.currentBlinkRate / 20) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">Normal: 15-20/min</p>
          </div>

          {/* Total Blinks */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-slate-400 mb-3">
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">Total Blinks</span>
            </div>
            <p className="text-2xl font-bold text-white">{state.blinkCount}</p>
          </div>

          {/* Eye Status + Closures */}
          <div className="bg-slate-900/60 border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-slate-400 mb-3">
              <Activity className="h-4 w-4" />
              <span className="text-sm font-medium">Eye Status</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${state.eyesOpen ? 'bg-emerald-400' : 'bg-red-400'} ${state.isRunning ? 'animate-pulse' : ''}`} />
                <span className="text-sm text-white font-medium">{state.isRunning ? (state.eyesOpen ? 'Open' : 'Closed') : '--'}</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">Drowsy Events</p>
                <p className="text-lg font-bold text-amber-400">{state.longClosureEvents}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
