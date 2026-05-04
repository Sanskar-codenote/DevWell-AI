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

interface FaceLandmarkerResults {
  faceLandmarks?: FaceLandmark[][];
}

interface FaceLandmarkerInstance {
  detectForVideo: (image: CanvasImageSource, timestampMs: number) => FaceLandmarkerResults;
  close: () => void;
}

interface ImageCaptureLike {
  grabFrame: () => Promise<ImageBitmap>;
}

interface HiddenTrackReader {
  read: () => Promise<{ done: boolean; value?: unknown }>;
  cancel?: () => Promise<void>;
  releaseLock?: () => void;
}

interface FilesetResolverInstance {}

interface FilesetResolverStatic {
  forVisionTasks: (wasmBasePath: string) => Promise<FilesetResolverInstance>;
}

interface FaceLandmarkerStatic {
  createFromOptions: (
    filesetResolver: FilesetResolverInstance,
    options: {
      baseOptions: { modelAssetPath: string; delegate?: 'CPU' | 'GPU' };
      runningMode: 'VIDEO';
      numFaces: number;
      outputFaceBlendshapes?: boolean;
    }
  ) => Promise<FaceLandmarkerInstance>;
}

interface VisionBundleModule {
  FaceLandmarker: FaceLandmarkerStatic;
  FilesetResolver: FilesetResolverStatic;
}

let visionBundlePromise: Promise<VisionBundleModule> | null = null;

function loadVisionBundle(): Promise<VisionBundleModule> {
  if (!visionBundlePromise) {
    visionBundlePromise = import('@mediapipe/tasks-vision') as unknown as Promise<VisionBundleModule>;
  }
  return visionBundlePromise;
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

// MediaPipe eye landmark indices
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
const REOPEN_STABILITY_MS = 90;
const HIDDEN_READER_TIMEOUT_MS = 280;
const HIDDEN_GRAB_TIMEOUT_MS = 280;
const HIDDEN_LOOP_BACKOFF_MS = 40;
const BACKGROUND_DROWSY_MIN_CLOSED_SAMPLES = 3;
const BACKGROUND_SPARSE_GAP_MS = 700;
const VISIBLE_FRAME_INTERVAL_MS = 66; // ~15 FPS

interface NotificationSettings {
  lowFatigueThreshold: number;
  highFatigueThreshold: number;
  fatigueNotificationIntervalMinutes: number;
  enableModerateFatigueNotification: boolean;
  enableHighFatigueNotification: boolean;
  enableBreakNotification: boolean;
}

function getDefaultNotificationSettings(): NotificationSettings {
  return {
    lowFatigueThreshold: 50,
    highFatigueThreshold: 80,
    fatigueNotificationIntervalMinutes: 60,
    enableModerateFatigueNotification: true,
    enableHighFatigueNotification: true,
    enableBreakNotification: true,
  };
}

export class FatigueEngine {
  private faceLandmarker: FaceLandmarkerInstance | null = null;
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
  private backgroundFallbackId: number | null = null; // For background tab processing
  private hiddenFrameLoopActive = false;
  private running = false;
  private isTabVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true; 
  private wakeLock: WakeLockSentinel | null = null; // Keep screen awake
  private lastFatigueAlertAt = 0;
  private earThreshold = DEFAULT_EAR_THRESHOLD;
  private openEARBaseline = 0;
  private earCalibrationSamples: number[] = [];
  private calibrationStartedAt = 0;
  private minEARDuringClosure = 1;
  private unknownStateStartAt = 0;
  private openStateStartAt = 0;
  private lastBlinkAt = 0;
  private closureSampleCount = 0;
  private lastResultAt = 0;
  private lastVisibleProcessAt = 0;
  private processingCanvas: HTMLCanvasElement | null = null;
  private processingCtx: CanvasRenderingContext2D | null = null;
  private cameraStream: MediaStream | null = null;
  private imageCapture: ImageCaptureLike | null = null;
  private hiddenTrackReader: HiddenTrackReader | null = null;

  constructor(onUpdate: FatigueCallback, onAlert: AlertCallback) {
    this.onFatigueUpdate = onUpdate;
    this.onAlert = onAlert;
    
    if (typeof document !== 'undefined') {
      this.processingCanvas = document.createElement('canvas');
      this.processingCanvas.width = 640;
      this.processingCanvas.height = 480;
      this.processingCtx = this.processingCanvas.getContext('2d', { willReadFrequently: true });
      document.addEventListener('visibilitychange', () => {
        this.isTabVisible = document.visibilityState === 'visible';

        if (this.isTabVisible) {
          console.log('[DevWell] Tab is now visible, resuming normal processing');
          if (this.running) {
            void this.requestWakeLock();
          }
        } else {
          console.log('[DevWell] Tab is hidden, switching to background mode');
        }

        if (this.running) {
          this.scheduleNextFrame();
        }
      });
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[DevWell] Wake Lock acquired');
        
        this.wakeLock.addEventListener('release', () => {
          console.log('[DevWell] Wake Lock released');
        });
      }
    } catch (err) {
      console.warn('[DevWell] Failed to acquire Wake Lock:', err);
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  private clearFrameLoopHandles(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.backgroundFallbackId) {
      clearTimeout(this.backgroundFallbackId);
      this.backgroundFallbackId = null;
    }
  }

  private scheduleNextFrame(): void {
    if (!this.running) return;

    this.clearFrameLoopHandles();

    if (!this.isTabVisible) {
      this.ensureHiddenFrameProviders();
    }

    if (!this.isTabVisible) {
      if (!this.hiddenFrameLoopActive) {
        void this.runHiddenFrameLoop();
      }
      return;
    }

    if (this.isTabVisible) {
      this.animationFrameId = requestAnimationFrame(() => this.processFrame());
      return;
    }
  }

  private checkBreakReminder(now: number): void {
    const settings = this.getNotificationSettings();
    if (!settings.enableBreakNotification) return;
    if (now - this.lastBreakAlert >= BREAK_INTERVAL_MS) {
      this.lastBreakAlert = now;
      this.onAlert('break', 'Time for a break! Follow the 20-20-20 rule: Look at something 20 feet away for 20 seconds.');
    }
  }

  private getNotificationSettings(): NotificationSettings {
    const defaults = getDefaultNotificationSettings();
    if (typeof localStorage === 'undefined') return defaults;

    try {
      const raw = localStorage.getItem('userSettings');
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);

      const lowFatigueThreshold = Number(parsed.lowFatigueThreshold ?? defaults.lowFatigueThreshold);
      const highFatigueThreshold = Number(parsed.highFatigueThreshold ?? defaults.highFatigueThreshold);
      const fatigueNotificationIntervalMinutes = Number(
        parsed.fatigueNotificationIntervalMinutes ?? defaults.fatigueNotificationIntervalMinutes
      );

      return {
        lowFatigueThreshold: Number.isFinite(lowFatigueThreshold) ? lowFatigueThreshold : defaults.lowFatigueThreshold,
        highFatigueThreshold: Number.isFinite(highFatigueThreshold) ? highFatigueThreshold : defaults.highFatigueThreshold,
        fatigueNotificationIntervalMinutes: Number.isFinite(fatigueNotificationIntervalMinutes)
          ? fatigueNotificationIntervalMinutes
          : defaults.fatigueNotificationIntervalMinutes,
        enableModerateFatigueNotification: parsed.enableModerateFatigueNotification !== false,
        enableHighFatigueNotification: parsed.enableHighFatigueNotification !== false,
        enableBreakNotification: parsed.enableBreakNotification ?? parsed.enable20MinNotification ?? true,
      };
    } catch {
      return defaults;
    }
  }

  private createImageCapture(stream: MediaStream): ImageCaptureLike | null {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof window === 'undefined') return null;

    const ImageCaptureCtor = (window as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => ImageCaptureLike;
    }).ImageCapture;

    if (!ImageCaptureCtor) return null;

    try {
      return new ImageCaptureCtor(track);
    } catch (err) {
      console.warn('[DevWell] ImageCapture unavailable for this camera track:', err);
      return null;
    }
  }

  private createHiddenTrackReader(stream: MediaStream): HiddenTrackReader | null {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof window === 'undefined') return null;

    const ProcessorCtor = (window as unknown as {
      MediaStreamTrackProcessor?: new (config: { track: MediaStreamTrack }) => {
        readable: { getReader: () => HiddenTrackReader };
      };
    }).MediaStreamTrackProcessor;

    if (!ProcessorCtor) return null;

    try {
      const processor = new ProcessorCtor({ track });
      return processor.readable.getReader();
    } catch (err) {
      console.warn('[DevWell] MediaStreamTrackProcessor unavailable for this track:', err);
      return null;
    }
  }

  private closeHiddenTrackReader(): void {
    const reader = this.hiddenTrackReader;
    this.hiddenTrackReader = null;
    if (!reader) return;
    if (reader.cancel) {
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock?.();
  }

  private ensureHiddenFrameProviders(): void {
    if (!this.cameraStream) return;
    if (!this.hiddenTrackReader) {
      this.hiddenTrackReader = this.createHiddenTrackReader(this.cameraStream);
    }
    if (!this.imageCapture) {
      this.imageCapture = this.createImageCapture(this.cameraStream);
    }
  }

  private async detectFromHiddenTrackReader(): Promise<boolean> {
    if (!this.hiddenTrackReader || !this.processingCtx || !this.processingCanvas) return false;

    try {
      const frame = await Promise.race([
        this.hiddenTrackReader.read(),
        new Promise<{ done: true }>((resolve) =>
          window.setTimeout(() => resolve({ done: true }), HIDDEN_READER_TIMEOUT_MS)
        ),
      ]);
      if (frame.done || !frame.value) {
        this.closeHiddenTrackReader();
        return false;
      }

      const videoFrame = frame.value as CanvasImageSource & { close?: () => void };
      try {
        this.processingCtx.drawImage(videoFrame, 0, 0, this.processingCanvas.width, this.processingCanvas.height);
        this.runDetection(this.processingCanvas);
      } finally {
        videoFrame.close?.();
      }
      return true;
    } catch (err) {
      console.warn('[DevWell] Hidden track reader failed, switching source:', err);
      this.closeHiddenTrackReader();
      return false;
    }
  }

  private runDetection(image: CanvasImageSource): void {
    if (!this.faceLandmarker) return;
    const results = this.faceLandmarker.detectForVideo(image, performance.now());
    this.processResults(results);
  }

  private async runHiddenFrameLoop(): Promise<void> {
    if (
      this.hiddenFrameLoopActive ||
      !this.running ||
      this.isTabVisible
    ) {
      return;
    }

    this.hiddenFrameLoopActive = true;

    try {
      while (this.running && !this.isTabVisible) {
        this.ensureHiddenFrameProviders();

        let detected = false;

        if (this.hiddenTrackReader) {
          detected = await this.detectFromHiddenTrackReader();
        }

        if (!detected && this.imageCapture) {
          try {
            const bitmap = await Promise.race([
              this.imageCapture.grabFrame(),
              new Promise<null>((resolve) =>
                window.setTimeout(() => resolve(null), HIDDEN_GRAB_TIMEOUT_MS)
              ),
            ]);
            if (!bitmap) {
              this.imageCapture = null;
              continue;
            }
            try {
              if (this.processingCtx && this.processingCanvas) {
                this.processingCtx.drawImage(bitmap, 0, 0, this.processingCanvas.width, this.processingCanvas.height);
                this.runDetection(this.processingCanvas);
              } else {
                this.runDetection(bitmap);
              }
              detected = true;
            } finally {
              bitmap.close();
            }
          } catch (error) {
            console.warn('[DevWell] Hidden ImageCapture failed, switching source:', error);
            this.imageCapture = null;
          }
        }

        if (!detected && this.videoElement?.readyState && this.videoElement.readyState >= 2) {
          if (this.processingCtx && this.processingCanvas) {
            this.processingCtx.drawImage(this.videoElement, 0, 0, this.processingCanvas.width, this.processingCanvas.height);
            this.runDetection(this.processingCanvas);
          } else {
            this.runDetection(this.videoElement);
          }
        }

        this.checkBreakReminder(Date.now());
        if (!detected) {
          await new Promise(resolve => setTimeout(resolve, HIDDEN_LOOP_BACKOFF_MS));
        }
      }
    } finally {
      this.hiddenFrameLoopActive = false;
      if (this.running && this.isTabVisible) {
        this.scheduleNextFrame();
      }
    }
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
      this.lastResultAt = 0;
      this.lastVisibleProcessAt = 0;
      this.closureSampleCount = 0;
      this.lastFatigueAlertAt = 0;
      this.hiddenFrameLoopActive = false;
      this.closeHiddenTrackReader();
      this.cameraStream = null;
      this.imageCapture = null;
      const { FilesetResolver, FaceLandmarker } = await loadVisionBundle();
      const filesetResolver = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: '/mediapipe/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });

      // Start camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      this.cameraStream = stream;
      videoElement.srcObject = stream;
      this.hiddenTrackReader = this.createHiddenTrackReader(stream);
      this.imageCapture = this.createImageCapture(stream);
      
      await videoElement.play();

      // Request wake lock to keep the tab active
      await this.requestWakeLock();

      void this.processFrame();
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
    if (!this.running || !this.faceLandmarker) return;

    if (!this.isTabVisible) {
      this.scheduleNextFrame();
      return;
    }

    const nowPerf = performance.now();
    if (nowPerf - this.lastVisibleProcessAt < VISIBLE_FRAME_INTERVAL_MS) {
      this.scheduleNextFrame();
      return;
    }
    this.lastVisibleProcessAt = nowPerf;

    if (this.videoElement && this.videoElement.readyState >= 2) {
      if (this.processingCtx && this.processingCanvas) {
        this.processingCtx.drawImage(this.videoElement, 0, 0, this.processingCanvas.width, this.processingCanvas.height);
        this.runDetection(this.processingCanvas);
      } else {
        this.runDetection(this.videoElement);
      }
    }

    this.checkBreakReminder(Date.now());
    this.scheduleNextFrame();
  }

  private processResults(results: FaceLandmarkerResults): void {
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      this.handleUnknownTrackingFrame(Date.now());
      this.emitState();
      return;
    }

    const landmarks = results.faceLandmarks[0];
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
    const frameGap = this.lastResultAt > 0 ? now - this.lastResultAt : 0;
    this.lastResultAt = now;
    const isBackground = !this.isTabVisible;
    const eyesCurrentlyClosed =
      avgEAR < this.earThreshold &&
      Math.max(leftEAR, rightEAR) < this.earThreshold * 1.08;

    // Log EAR values to help debug
    if (this.blinkCount % 10 === 0 || !this.eyesClosed !== !eyesCurrentlyClosed) {
      console.log(`[EAR] Avg: ${avgEAR.toFixed(3)}, Threshold: ${this.earThreshold.toFixed(3)}, Closed: ${eyesCurrentlyClosed}`);
    }

    if (eyesCurrentlyClosed) {
      this.openStateStartAt = 0;
      if (!this.eyesClosed) {
        // Eyes just closed
        this.eyesClosed = true;
        this.eyeClosedStart = now;
        this.closureSampleCount = 1;
        this.drowsinessCountedForCurrentClosure = false;
        this.minEARDuringClosure = avgEAR;
      } else {
        this.closureSampleCount += 1;
        this.minEARDuringClosure = Math.min(this.minEARDuringClosure, avgEAR);
      }

      // Drowsiness detection
      const closedDuration = now - this.eyeClosedStart;
      if (
        closedDuration >= DROWSINESS_THRESHOLD_MS &&
        (!isBackground || this.closureSampleCount >= BACKGROUND_DROWSY_MIN_CLOSED_SAMPLES) &&
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
        if (timeSinceOpen < REOPEN_STABILITY_MS && !isBackground) {
          // Still waiting for stability, just emit state and continue tracking
          this.emitState();
          return;
        }

        // Stability period passed, classify the closure event
        // Use 'now' to get the actual total closure duration
        const closureDuration = now - this.eyeClosedStart;
        console.log(`[Blink] Classifying closure: ${closureDuration}ms (threshold: ${BLINK_MIN_MS}-${DROWSINESS_THRESHOLD_MS}ms)`);

        const sparseBackgroundClosure =
          isBackground &&
          closureDuration >= DROWSINESS_THRESHOLD_MS &&
          this.closureSampleCount <= 2 &&
          frameGap >= BACKGROUND_SPARSE_GAP_MS;

        if (sparseBackgroundClosure) {
          if (now - this.lastBlinkAt >= BLINK_REFRACTORY_MS) {
            this.blinkCount++;
            this.blinkHistory.push(now);
            this.lastBlinkAt = now;
            console.log(
              `[Blink] ✓ Background sparse closure treated as blink. Count: ${this.blinkCount}, Duration: ${closureDuration}ms`
            );
          }
        } else if (closureDuration >= DROWSINESS_THRESHOLD_MS) {
          // Long closures are drowsiness events and must never be counted as blinks.
          if (!this.drowsinessCountedForCurrentClosure) {
            this.longClosureEvents++;
            this.drowsinessCountedForCurrentClosure = true;
            console.log(`[Drowsy] Long closure detected: ${closureDuration}ms`);
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
          console.log(`[Blink] ✓ Detected! Count: ${this.blinkCount}, Duration: ${closureDuration}ms`);
        } else {
          console.log(`[Blink] ✗ Not counted - Duration: ${closureDuration}ms, Since last blink: ${now - this.lastBlinkAt}ms`);
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
    this.closureSampleCount = 0;
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
      !this.isTabVisible &&
      now - this.unknownStateStartAt < UNKNOWN_FRAME_RESET_MS
    ) {
      return;
    }

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

    const settings = this.getNotificationSettings();
    const alertIntervalMs = Math.max(1, settings.fatigueNotificationIntervalMinutes) * 60 * 1000;
    const shouldThrottle = this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= alertIntervalMs;

    if (shouldThrottle) {
      const isHigh = fatigueScore > settings.highFatigueThreshold;
      const isModerate = fatigueScore > settings.lowFatigueThreshold && !isHigh;

      if (isHigh && settings.enableHighFatigueNotification) {
        this.lastFatigueAlertAt = now;
        this.onAlert('fatigue_high', 'High fatigue detected. Please take an immediate break.');
      } else if (isModerate && settings.enableModerateFatigueNotification) {
        this.lastFatigueAlertAt = now;
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
    this.clearFrameLoopHandles();
    this.hiddenFrameLoopActive = false;
    this.closeHiddenTrackReader();
    this.imageCapture = null;
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    
    // Release wake lock
    this.releaseWakeLock();

    // Stop camera
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    } else if (this.videoElement?.srcObject) {
      (this.videoElement.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      this.videoElement.srcObject = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
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
