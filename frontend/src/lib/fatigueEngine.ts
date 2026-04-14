// Fatigue detection engine using MediaPipe FaceMesh
// All processing happens client-side for privacy

export interface FatigueState {
  blinkCount: number;
  currentBlinkRate: number;
  sessionAvgBlinkRate: number;
  blinksPerMinute: number;
  fatigueScore: number;
  fatigueLevel: 'Fresh' | 'Moderate Fatigue' | 'High Fatigue';
  longClosureEvents: number;
  eyesOpen: boolean;
  sessionDurationMinutes: number;
  isRunning: boolean;
}

export interface SessionSummary extends FatigueState {
  sessionDate: string;
}

export interface RestoredSessionData {
  blinkCount: number;
  longClosureEvents: number;
  savedAt: number;
  durationAtSave: number;
}

interface FaceLandmark {
  x: number;
  y: number;
  z?: number;
}

interface FaceMeshResults {
  multiFaceLandmarks?: FaceLandmark[][];
}

interface FaceMeshInstance {
  setOptions: (options: {
    maxNumFaces: number;
    refineLandmarks: boolean;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
  }) => void;
  onResults: (callback: (results: FaceMeshResults) => void) => void;
  initialize: () => Promise<void>;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => void;
}

interface FaceMeshConstructor {
  new (config: { locateFile: (file: string) => string }): FaceMeshInstance;
}

declare global {
  interface Window {
    FaceMesh?: FaceMeshConstructor;
  }
}

type FatigueCallback = (state: FatigueState) => void;
type AlertCallback = (
  type: 'blink_rate' | 'break' | 'fatigue_moderate' | 'fatigue_high',
  message: string
) => void;

// Eye Aspect Ratio calculation using 6 landmark points per eye
function computeEAR(landmarks: FaceLandmark[], eyeIndices: number[]): number {
  const p = eyeIndices.map(i => landmarks[i]);
  // Vertical distances
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y);
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y);
  // Horizontal distance
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y);
  return (v1 + v2) / (2.0 * h);
}

// MediaPipe FaceMesh eye landmark indices
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

const DEFAULT_EAR_THRESHOLD = 0.21;
const MIN_EAR_THRESHOLD = 0.16;
const MAX_EAR_THRESHOLD = 0.30;
const EAR_OPEN_FRACTION = 0.68; // Eye-closed threshold as a fraction of calibrated open-eye EAR
const BLINK_MIN_MS = 50;
const DROWSINESS_THRESHOLD_MS = 1500;
const BLINK_REFRACTORY_MS = 80;
const LOW_BLINK_RATE = 8;
const BREAK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_EYE_ASYMMETRY_RATIO = 1.8;
const MIN_VALID_EYE_WIDTH = 0.018;
const UNKNOWN_FRAME_RESET_MS = 2500;
const FATIGUE_ALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REOPEN_STABILITY_MS = 90;

export class FatigueEngine {
  private faceMesh: FaceMeshInstance | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private onFatigueUpdate: FatigueCallback;
  private onAlert: AlertCallback;

  private blinkCount = 0;
  private eyesClosed = false;
  private eyeClosedStart = 0;
  private drowsinessCountedForCurrentClosure = false;
  private longClosureEvents = 0;
  private currentBlinkRate = 0;
  private sessionAvgBlinkRate = 0;
  private blinkHistory: number[] = [];
  private sessionStart = 0;
  private lastBreakAlert = 0;
  private animationFrameId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private running = false;
  private lastFatigueAlertAt = 0;
  private earThreshold = DEFAULT_EAR_THRESHOLD;
  private openEARBaseline = 0;
  private earCalibrationSamples: number[] = [];
  private calibrationStartedAt = 0;
  private minEARDuringClosure = 1;
  private unknownStateStartAt = 0;
  private openStateStartAt = 0;
  private lastBlinkAt = 0;

  constructor(onUpdate: FatigueCallback, onAlert: AlertCallback) {
    this.onFatigueUpdate = onUpdate;
    this.onAlert = onAlert;
  }

  async start(videoElement: HTMLVideoElement, restoredData?: RestoredSessionData): Promise<void> {
    try {
      this.videoElement = videoElement;
      const restoredSessionAvg = restoredData?.durationAtSave && restoredData.blinkCount > 0
        ? Math.round(restoredData.blinkCount / Math.max(restoredData.durationAtSave, 1))
        : 0;
      
      // Check if we have restored session data
      if (restoredData) {
        // Restore the session start time by calculating backwards from when it was saved
        // This preserves the actual elapsed time
        const savedDuration = restoredData.durationAtSave || 0;
        const savedAt = restoredData.savedAt || Date.now();
        this.sessionStart = savedAt - (savedDuration * 60000);
        
        this.blinkCount = restoredData.blinkCount || 0;
        this.longClosureEvents = restoredData.longClosureEvents || 0;
        this.blinkHistory = []; // Will be rebuilt as new blinks occur
        this.lastBreakAlert = Date.now();
        
        // Calculate session average blink rate from restored data
        this.sessionAvgBlinkRate = restoredSessionAvg;
        // Current blink rate starts at 0 (no blinks in last 60s yet)
        this.currentBlinkRate = 0;
      } else {
        // Fresh session
        this.sessionStart = Date.now();
        this.lastBreakAlert = Date.now();
        this.blinkCount = 0;
        this.longClosureEvents = 0;
        this.blinkHistory = [];
        this.sessionAvgBlinkRate = 0;
        this.currentBlinkRate = 0;
      }
      
      this.running = true;
      this.earThreshold = DEFAULT_EAR_THRESHOLD;
      this.openEARBaseline = 0;
      this.earCalibrationSamples = [];
      this.calibrationStartedAt = Date.now();
      this.minEARDuringClosure = 1;
      this.unknownStateStartAt = 0;
      this.openStateStartAt = 0;
      this.lastBlinkAt = 0;
      this.lastFatigueAlertAt = 0;
      // Load FaceMesh via CDN
      const FaceMesh = window.FaceMesh;
      
      // Wait for FaceMesh to load if not available immediately
      if (!FaceMesh) {
        await new Promise<void>((resolve, reject) => {
          let attempts = 0;
          const maxAttempts = 50; // 5 seconds with 100ms intervals
          const checkInterval = setInterval(() => {
            attempts++;
            const fm = window.FaceMesh;
            if (fm) {
              clearInterval(checkInterval);
              resolve();
            } else if (attempts >= maxAttempts) {
              clearInterval(checkInterval);
              reject(new Error('MediaPipe FaceMesh failed to load. Please check your internet connection and refresh the page.'));
            }
          }, 100);
        });
      }

      const FaceMeshFinal = window.FaceMesh;
      if (!FaceMeshFinal) {
        throw new Error('MediaPipe FaceMesh is unavailable.');
      }

      this.faceMesh = new FaceMeshFinal({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.faceMesh.onResults((results: FaceMeshResults) => {
        this.processResults(results);
      });
      
      await this.faceMesh.initialize();

      // Start camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      videoElement.srcObject = stream;
      
      await videoElement.play();

      this.processFrame();
      this.startHeartbeat();
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
    }

    // Keep timer/fatigue state fresh even when frame processing is throttled.
    this.heartbeatIntervalId = window.setInterval(() => {
      if (!this.running) return;
      this.emitState();
    }, 1000);
  }

  private async processFrame(): Promise<void> {
    if (!this.running || !this.videoElement || !this.faceMesh) return;

    if (this.videoElement.readyState >= 2) {
      await this.faceMesh.send({ image: this.videoElement });
    }

    // Check break reminder
    const now = Date.now();
    if (now - this.lastBreakAlert >= BREAK_INTERVAL_MS) {
      this.lastBreakAlert = now;
      this.onAlert('break', 'Time for a break! Follow the 20-20-20 rule: Look at something 20 feet away for 20 seconds.');
    }

    this.animationFrameId = requestAnimationFrame(() => this.processFrame());
  }

  private processResults(results: FaceMeshResults): void {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.handleUnknownTrackingFrame(Date.now());
      this.emitState();
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const leftEAR = computeEAR(landmarks, LEFT_EYE);
    const rightEAR = computeEAR(landmarks, RIGHT_EYE);
    const avgEAR = (leftEAR + rightEAR) / 2;
    this.updateEARCalibration(avgEAR);

    const leftEyeWidth = Math.hypot(
      landmarks[LEFT_EYE[0]].x - landmarks[LEFT_EYE[3]].x,
      landmarks[LEFT_EYE[0]].y - landmarks[LEFT_EYE[3]].y
    );
    const rightEyeWidth = Math.hypot(
      landmarks[RIGHT_EYE[0]].x - landmarks[RIGHT_EYE[3]].x,
      landmarks[RIGHT_EYE[0]].y - landmarks[RIGHT_EYE[3]].y
    );
    const minEyeWidth = Math.min(leftEyeWidth, rightEyeWidth);
    const maxEyeWidth = Math.max(leftEyeWidth, rightEyeWidth);
    const eyeAsymmetryRatio = maxEyeWidth / Math.max(minEyeWidth, 1e-6);
    const unreliablePose = minEyeWidth < MIN_VALID_EYE_WIDTH || eyeAsymmetryRatio > MAX_EYE_ASYMMETRY_RATIO;
    if (unreliablePose) {
      this.handleUnknownTrackingFrame(Date.now());
      this.emitState();
      return;
    }
    this.unknownStateStartAt = 0;

    const now = Date.now();
    const eyesCurrentlyClosed =
      avgEAR < this.earThreshold &&
      Math.max(leftEAR, rightEAR) < this.earThreshold * 1.08;

    if (eyesCurrentlyClosed) {
      this.openStateStartAt = 0;
      if (!this.eyesClosed) {
        // Eyes just closed
        this.eyesClosed = true;
        this.eyeClosedStart = now;
        this.drowsinessCountedForCurrentClosure = false;
        this.minEARDuringClosure = avgEAR;
      } else {
        this.minEARDuringClosure = Math.min(this.minEARDuringClosure, avgEAR);
      }

      // Drowsiness detection
      const closedDuration = now - this.eyeClosedStart;
      if (
        closedDuration >= DROWSINESS_THRESHOLD_MS &&
        !this.drowsinessCountedForCurrentClosure
      ) {
        this.longClosureEvents++;
        this.drowsinessCountedForCurrentClosure = true;
      }
    } else {
      // Eyes are currently open
      if (this.eyesClosed) {
        // We were previously closed, track when eyes opened
        if (this.openStateStartAt === 0) {
          this.openStateStartAt = now;
        }

        // Wait for reopen stability before classifying the closure event
        const timeSinceOpen = now - this.openStateStartAt;
        if (timeSinceOpen < REOPEN_STABILITY_MS) {
          // Still waiting for stability, just emit state and continue tracking
          this.emitState();
          return;
        }

        // Stability period passed, classify the closure event
        // Use 'now' to get the actual total closure duration
        const closureDuration = now - this.eyeClosedStart;
        if (closureDuration >= DROWSINESS_THRESHOLD_MS) {
          // Long closures are drowsiness events and must never be counted as blinks.
          if (!this.drowsinessCountedForCurrentClosure) {
            this.longClosureEvents++;
            this.drowsinessCountedForCurrentClosure = true;
          }
        } else if (
          closureDuration >= BLINK_MIN_MS &&
          closureDuration < DROWSINESS_THRESHOLD_MS &&
          now - this.lastBlinkAt >= BLINK_REFRACTORY_MS
        ) {
          // Valid blink detected
          this.blinkCount++;
          this.blinkHistory.push(now);
          this.lastBlinkAt = now;
        }
        
        // Reset closure tracking after classification
        this.resetClosureTracking();
      }
      this.eyesClosed = false;
    }

    // Current blink rate: rolling last 60 seconds.
    const sessionMinutes = (now - this.sessionStart) / 60000;
    const oneMinuteAgo = now - 60000;
    this.blinkHistory = this.blinkHistory.filter(t => t > oneMinuteAgo);
    this.currentBlinkRate = this.blinkHistory.length;

    // Session average blink rate: smoothed denominator in first minute to avoid spikes.
    const normalizedMinutes = Math.max(sessionMinutes, 1);
    this.sessionAvgBlinkRate = sessionMinutes > 0
      ? Math.round(this.blinkCount / normalizedMinutes)
      : 0;

    // Low blink rate alert
    if (sessionMinutes > 1 && this.currentBlinkRate < LOW_BLINK_RATE && this.currentBlinkRate > 0) {
      // Only alert once per minute
    }

    this.emitState();
  }

  private updateEARCalibration(avgEAR: number): void {
    if (!Number.isFinite(avgEAR) || avgEAR <= 0) return;

    // Collect EAR samples for initial calibration, then keep adapting slowly.
    if (Date.now() - this.calibrationStartedAt <= 5000 || this.earCalibrationSamples.length < 25) {
      this.earCalibrationSamples.push(avgEAR);
      if (this.earCalibrationSamples.length > 80) {
        this.earCalibrationSamples.shift();
      }
      const sorted = [...this.earCalibrationSamples].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * 0.8); // 80th percentile approximates open-eye EAR
      const p80 = sorted[Math.min(idx, sorted.length - 1)];
      if (p80 > 0) {
        this.openEARBaseline = p80;
      }
    } else if (!this.eyesClosed && avgEAR > this.earThreshold) {
      // Adapt baseline gradually to lighting/angle changes while eyes are likely open.
      this.openEARBaseline = this.openEARBaseline === 0
        ? avgEAR
        : this.openEARBaseline * 0.985 + avgEAR * 0.015;
    }

    const candidateThreshold = this.openEARBaseline > 0
      ? this.openEARBaseline * EAR_OPEN_FRACTION
      : DEFAULT_EAR_THRESHOLD;
    this.earThreshold = Math.min(MAX_EAR_THRESHOLD, Math.max(MIN_EAR_THRESHOLD, candidateThreshold));
  }

  private resetClosureTracking(): void {
    this.eyesClosed = false;
    this.eyeClosedStart = 0;
    this.drowsinessCountedForCurrentClosure = false;
    this.minEARDuringClosure = 1;
    this.openStateStartAt = 0;
  }

  private handleUnknownTrackingFrame(now: number): void {
    if (!this.eyesClosed) return;

    if (this.unknownStateStartAt === 0) {
      this.unknownStateStartAt = now;
    }

    const closedDuration = now - this.eyeClosedStart;
    if (
      closedDuration >= DROWSINESS_THRESHOLD_MS &&
      !this.drowsinessCountedForCurrentClosure
    ) {
      this.longClosureEvents++;
      this.drowsinessCountedForCurrentClosure = true;
    }

    if (now - this.unknownStateStartAt >= UNKNOWN_FRAME_RESET_MS) {
      // Stop stale closed-state if tracking is lost for too long.
      this.resetClosureTracking();
      this.unknownStateStartAt = 0;
    }
  }

  private emitState(): void {
    const now = Date.now();
    const sessionMinutes = (now - this.sessionStart) / 60000;

    // Fatigue score calculation (0-100)
    // Use currentBlinkRate if available, otherwise fall back to sessionAvgBlinkRate (after restore)
    const effectiveBlinkRate = this.currentBlinkRate > 0 ? this.currentBlinkRate : this.sessionAvgBlinkRate;
    
    const blinkDeficit = sessionMinutes < 1
      ? 0
      : Math.max(0, (LOW_BLINK_RATE - effectiveBlinkRate) / LOW_BLINK_RATE) * 35;
    const closurePenalty = Math.min(this.longClosureEvents * 12, 36);
    // Let fatigue grow gradually with session duration after a short grace period.
    const durationPenalty = Math.min(Math.max(sessionMinutes - 3, 0) / 120 * 40, 40);
    const fatigueScore = Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));

    let fatigueLevel: FatigueState['fatigueLevel'] = 'Fresh';
    if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
    else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

    if (
      (fatigueLevel === 'Moderate Fatigue' || fatigueLevel === 'High Fatigue') &&
      (this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= FATIGUE_ALERT_INTERVAL_MS)
    ) {
      this.lastFatigueAlertAt = now;
      if (fatigueLevel === 'High Fatigue') {
        this.onAlert('fatigue_high', 'High fatigue detected. Please take an immediate break.');
      } else {
        this.onAlert('fatigue_moderate', 'Moderate fatigue detected. Consider taking a short break.');
      }
    }

    this.onFatigueUpdate({
      blinkCount: this.blinkCount,
      currentBlinkRate: this.currentBlinkRate,
      sessionAvgBlinkRate: this.sessionAvgBlinkRate,
      blinksPerMinute: this.sessionAvgBlinkRate,
      fatigueScore: Math.round(fatigueScore),
      fatigueLevel,
      longClosureEvents: this.longClosureEvents,
      eyesOpen: !this.eyesClosed,
      sessionDurationMinutes: sessionMinutes,
      isRunning: this.running,
    });
  }

  stop(): SessionSummary {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }

    // Stop camera
    if (this.videoElement?.srcObject) {
      (this.videoElement.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      this.videoElement.srcObject = null;
    }

    if (this.faceMesh) {
      this.faceMesh.close();
      this.faceMesh = null;
    }

    const sessionMinutes = (Date.now() - this.sessionStart) / 60000;
    const blinkDeficit = sessionMinutes < 1
      ? 0
      : Math.max(0, (LOW_BLINK_RATE - this.currentBlinkRate) / LOW_BLINK_RATE) * 35;
    const closurePenalty = Math.min(this.longClosureEvents * 12, 36);
    const durationPenalty = Math.min(Math.max(sessionMinutes - 3, 0) / 120 * 40, 40);
    const fatigueScore = Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));

    let fatigueLevel: FatigueState['fatigueLevel'] = 'Fresh';
    if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
    else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

    return {
      blinkCount: this.blinkCount,
      currentBlinkRate: this.currentBlinkRate,
      sessionAvgBlinkRate: sessionMinutes > 0 ? Math.round(this.blinkCount / sessionMinutes) : 0,
      blinksPerMinute: sessionMinutes > 0 ? Math.round(this.blinkCount / sessionMinutes) : 0,
      fatigueScore: Math.round(fatigueScore),
      fatigueLevel,
      longClosureEvents: this.longClosureEvents,
      eyesOpen: true,
      sessionDurationMinutes: parseFloat(sessionMinutes.toFixed(1)),
      isRunning: false,
      sessionDate: new Date().toISOString().split('T')[0],
    };
  }
}
