export type AttentionState = 'ATTENTIVE' | 'LOOKING_DOWN' | 'FACE_LOST';

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
  isPaused: boolean;
  isAutoPaused: boolean;

  faceDetected: boolean;
  cameraStatus: 'active' | 'inactive' | 'covered';
  lowBlinkRate: number;
  perclos: number;
  attentionState?: AttentionState;
  trackingQuality?: 'good' | 'limited' | 'poor';
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

interface FaceLandmarkerBlendshapesResult extends FaceLandmarkerResults {
  faceBlendshapes?: {
    categories: Blendshape[]
  }[];
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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

interface Blendshape {
  categoryName: string;
  score: number;
}

function getBlendshapeScore(blendshapes: Blendshape[], name: string): number {
  return blendshapes.find(b => b.categoryName === name)?.score ?? 0;
}

function areEyesClosed(left: number, right: number): boolean {
  if (left > 0.35 && right > 0.35) return true;
  if (left > 0.55 && right > 0.2) return true;
  if (right > 0.55 && left > 0.2) return true;
  return false;
}

function calculateHeadPitch(landmarks: FaceLandmark[]): number {
  const chin = landmarks[152];
  const forehead = landmarks[10];

  const faceVectorY = chin.y - forehead.y;
  const faceVectorZ = (chin.z ?? 0) - (forehead.z ?? 0);

  const pitchRad = Math.atan2(faceVectorZ, faceVectorY);
  return pitchRad * (180 / Math.PI);
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
  type: 'blink_rate' | 'break' | 'fatigue_moderate' | 'fatigue_high' | 'info' | 'error',
  message: string
) => void;

const BLINK_MIN_MS = 35;
const DROWSINESS_THRESHOLD_MS = 1500;
const BLINK_REFRACTORY_MS = 80;
const DEFAULT_LOW_BLINK_RATE = 15;
const BREAK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const UNKNOWN_FRAME_RESET_MS = 2500;
const REOPEN_STABILITY_MS = 90;
const HIDDEN_READER_TIMEOUT_MS = 280;
const HIDDEN_GRAB_TIMEOUT_MS = 280;
const HIDDEN_LOOP_BACKOFF_MS = 40;
const HIDDEN_LOOP_WATCHDOG_MS = 800;
const BACKGROUND_MIN_CLOSED_SAMPLES = 5;
const DROWSY_EVENT_COOLDOWN_MS = 10000;
const AUTO_PAUSE_THRESHOLD_MS = 20000; // 20 seconds of no face = auto-pause
const AUTO_PAUSE_THRESHOLD_HIDDEN_MS = 90000; // More tolerant in hidden tabs
const PERCLOS_WINDOW_MS = 60 * 1000; // 1 minute rolling window for PERCLOS
const MAX_VISIBLE_FRAME_GAP_MS = 450;
const MAX_HIDDEN_FRAME_GAP_MS = 900;
const MAX_METRIC_PITCH_DEG = 22;
const MIN_METRIC_PITCH_DEG = -15;
const MAX_EYE_ASYMMETRY = 0.65;
const MIN_FACE_BBOX_AREA = 0.035;

interface NotificationSettings {
  lowFatigueThreshold: number;
  highFatigueThreshold: number;
  fatigueNotificationIntervalMinutes: number;
  enableModerateFatigueNotification: boolean;
  enableHighFatigueNotification: boolean;
  enableBreakNotification: boolean;
  lowBlinkRate: number;
}

function getDefaultNotificationSettings(): NotificationSettings {
  return {
    lowFatigueThreshold: 50,
    highFatigueThreshold: 80,
    fatigueNotificationIntervalMinutes: 60,
    enableModerateFatigueNotification: true,
    enableHighFatigueNotification: true,
    enableBreakNotification: true,
    lowBlinkRate: DEFAULT_LOW_BLINK_RATE,
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
  private totalPausedTime = 0;
  private pauseStartAt = 0;
  private lastBreakAlert = 0;
  private animationFrameId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private backgroundFallbackId: number | null = null; // For background tab processing
  private hiddenFrameLoopActive = false;
  private running = false;
  private isPaused = false;
  private isAutoPaused = false;

  private faceDetected = false;
  private cameraStatus: FatigueState['cameraStatus'] = 'inactive';
  private lastFaceDetectedAt = 0;
  private isTabVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true; 
  private isWindowFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;
  private wakeLock: WakeLockSentinel | null = null; // Keep screen awake
  private lastFatigueAlertAt = 0;
  private unknownStateStartAt = 0;
  private openStateStartAt = 0;
  private lastBlinkAt = 0;
  private closureSampleCount = 0;
  private lastResultAt = 0;
  private lastHiddenDetectionAt = 0;
  private lastDrowsyEventAt = 0;

  // PERCLOS tracking
  private perclosValue = 0;
  private eyeClosureHistory: { start: number; end: number }[] = [];

  // Attention & Smoothing tracking
  private currentState: AttentionState = 'FACE_LOST';
  private smoothedFatigueScore = 0;
  private lastFatigueSmoothAt = 0;
  private stateHoldStart = 0;
  private pendingState: AttentionState = 'FACE_LOST';

  private blinkIntervals: number[] = [];
  private recentClosures: number[] = [];
  private trackingQuality: 'good' | 'limited' | 'poor' = 'good';

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
        this.isWindowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;

        if (this.isTabVisible) {
          console.log('[DevWell] Tab is now visible, resuming normal processing');
          if (this.running && !this.isPaused) {
            void this.requestWakeLock();
          }
        } else {
          console.log('[DevWell] Tab is hidden, switching to background mode');
        }

        if (this.running) {
          this.scheduleNextFrame();
        }
      });

      window.addEventListener('focus', () => {
        this.isWindowFocused = true;
      });

      window.addEventListener('blur', () => {
        this.isWindowFocused = false;
      });
    }
  }

  private getFaceBoundingBoxArea(landmarks: FaceLandmark[]): number {
    if (!Array.isArray(landmarks) || landmarks.length === 0) return 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of landmarks) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return 0;
    }

    const width = Math.max(0, maxX - minX);
    const height = Math.max(0, maxY - minY);
    return width * height;
  }

  private evaluateFrameQuality(
    frameGap: number,
    isBackground: boolean,
    pitch: number,
    eyeBlinkLeft: number,
    eyeBlinkRight: number,
    landmarks: FaceLandmark[]
  ): boolean {
    if (!Number.isFinite(eyeBlinkLeft) || !Number.isFinite(eyeBlinkRight)) return false;
    if (eyeBlinkLeft < 0 || eyeBlinkLeft > 1 || eyeBlinkRight < 0 || eyeBlinkRight > 1) return false;

    const maxFrameGap = isBackground ? MAX_HIDDEN_FRAME_GAP_MS : MAX_VISIBLE_FRAME_GAP_MS;
    if (frameGap > 0 && frameGap > maxFrameGap) return false;

    if (!Number.isFinite(pitch) || pitch > MAX_METRIC_PITCH_DEG || pitch < MIN_METRIC_PITCH_DEG) return false;
    if (Math.abs(eyeBlinkLeft - eyeBlinkRight) > MAX_EYE_ASYMMETRY) return false;

    const faceArea = this.getFaceBoundingBoxArea(landmarks);
    if (!Number.isFinite(faceArea) || faceArea < MIN_FACE_BBOX_AREA) return false;

    return true;
  }

  public pause(isAuto: boolean = false): void {
    if (!this.running || this.isPaused) return;
    this.isPaused = true;
    this.isAutoPaused = isAuto;
    this.pauseStartAt = Date.now();
    this.releaseWakeLock();
    if (!isAuto) {
      this.stopCamera();
      this.onAlert('info', 'Session paused. Camera turned off.');
    } else {
      if (this.isTabVisible) {
        this.onAlert('info', 'No face detected. Session auto-paused.');
      }
    }
    this.emitState();
  }

  public async resume(): Promise<void> {
    if (!this.running || !this.isPaused) return;
    const wasAutoPaused = this.isAutoPaused;
    this.isPaused = false;
    this.isAutoPaused = false;

    if (!wasAutoPaused) {
      try {
        await this.startCamera();
      } catch {
        this.onAlert('error', 'Failed to restart camera.');
        this.pause(false);
        return;
      }
    }

    if (this.pauseStartAt > 0) {
      this.totalPausedTime += Date.now() - this.pauseStartAt;
      this.pauseStartAt = 0;
    }
    if (this.isTabVisible) {
      void this.requestWakeLock();
    }
    if (!wasAutoPaused) {
      this.onAlert('info', 'Session resumed.');
    }
    this.emitState();
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
    } catch {
      console.warn('[DevWell] Failed to acquire Wake Lock:');
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      void this.wakeLock.release().catch(() => undefined);
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
    this.ensureHiddenFrameProviders();
    if (!this.hiddenFrameLoopActive) {
      void this.runHiddenFrameLoop();
    }
    this.backgroundFallbackId = window.setTimeout(() => {
      if (this.running && !this.hiddenFrameLoopActive) {
        void this.runHiddenFrameLoop();
      }
    }, HIDDEN_LOOP_WATCHDOG_MS);
  }

  private checkBreakReminder(now: number): void {
    if (this.isPaused) return;
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
      const lowBlinkRate = Number(parsed.lowBlinkRate ?? defaults.lowBlinkRate);

      return {
        lowFatigueThreshold: Number.isFinite(lowFatigueThreshold) ? lowFatigueThreshold : defaults.lowFatigueThreshold,
        highFatigueThreshold: Number.isFinite(highFatigueThreshold) ? highFatigueThreshold : defaults.highFatigueThreshold,
        fatigueNotificationIntervalMinutes: Number.isFinite(fatigueNotificationIntervalMinutes)
          ? fatigueNotificationIntervalMinutes
          : defaults.fatigueNotificationIntervalMinutes,
        enableModerateFatigueNotification: parsed.enableModerateFatigueNotification !== false,
        enableHighFatigueNotification: parsed.enableHighFatigueNotification !== false,
        enableBreakNotification: parsed.enableBreakNotification ?? parsed.enable20MinNotification ?? true,
        lowBlinkRate: Number.isFinite(lowBlinkRate) ? lowBlinkRate : defaults.lowBlinkRate,
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
    } catch {
      console.warn('[DevWell] ImageCapture unavailable for this camera track:');
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
    } catch {
      console.warn('[DevWell] MediaStreamTrackProcessor unavailable for this track:');
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
        this.lastHiddenDetectionAt = Date.now();
      } finally {
        videoFrame.close?.();
      }
      return true;
    } catch {
      console.warn('[DevWell] Hidden track reader failed, switching source:');
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
      !this.running
    ) {
      return;
    }

    this.hiddenFrameLoopActive = true;

    try {
      while (this.running) {
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
              this.lastHiddenDetectionAt = Date.now();
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
          this.lastHiddenDetectionAt = Date.now();
          detected = true;
        }

        if (!detected && this.videoElement) {
          try {
            if (this.processingCtx && this.processingCanvas) {
              this.processingCtx.drawImage(this.videoElement, 0, 0, this.processingCanvas.width, this.processingCanvas.height);
              this.runDetection(this.processingCanvas);
            } else {
              this.runDetection(this.videoElement);
            }
            this.lastHiddenDetectionAt = Date.now();
            detected = true;
          } catch {
            // Ignore draw failures while hidden; providers are retried continuously.
          }
        }

        this.checkBreakReminder(Date.now());
        if (!detected) {
          if (Date.now() - this.lastHiddenDetectionAt > HIDDEN_LOOP_WATCHDOG_MS * 2) {
            this.closeHiddenTrackReader();
            this.imageCapture = null;
          }
          await new Promise(resolve => setTimeout(resolve, HIDDEN_LOOP_BACKOFF_MS));
        } else {
          // Let stream readers dictate cadence when available; otherwise yield briefly.
          if (!this.hiddenTrackReader) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
      }
    } finally {
      this.hiddenFrameLoopActive = false;
      if (this.running) {
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
        this.lastDrowsyEventAt = 0;
      } else {
        // Fresh session
        this.sessionStart = Date.now();
        this.lastBreakAlert = Date.now();
        this.blinkCount = 0;
        this.longClosureEvents = 0;
        this.blinkHistory = [];
        this.sessionAvgBlinkRate = 0;
        this.currentBlinkRate = 0;
        this.lastDrowsyEventAt = 0;
      }
      
      this.running = true;
      this.isPaused = false;
      this.isAutoPaused = false;
      this.totalPausedTime = 0;
      this.pauseStartAt = 0;
      this.faceDetected = false;
      this.cameraStatus = 'active';
      this.lastFaceDetectedAt = Date.now();
      this.unknownStateStartAt = 0;
      this.openStateStartAt = 0;
      this.lastBlinkAt = 0;
      this.lastResultAt = 0;
      this.lastHiddenDetectionAt = Date.now();
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

      await this.startCamera();

      // Request wake lock to keep the tab active
      await this.requestWakeLock();

      this.scheduleNextFrame();
      this.startHeartbeat();
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  private async startCamera(): Promise<void> {
    if (!this.videoElement) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    this.cameraStream = stream;
    this.videoElement.srcObject = stream;
    this.hiddenTrackReader = this.createHiddenTrackReader(stream);
    this.imageCapture = this.createImageCapture(stream);
    this.cameraStatus = 'active';
    await this.videoElement.play();
  }

  private stopCamera(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = null;
    } else if (this.videoElement?.srcObject) {
      (this.videoElement.srcObject as MediaStream).getTracks().forEach(track => track.stop());
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.closeHiddenTrackReader();
    this.imageCapture = null;
    this.cameraStatus = 'inactive';
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

  private processResults(results: FaceLandmarkerResults): void {
    const now = Date.now();
    
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      this.faceDetected = false;
      this.handleUnknownTrackingFrame(now);
      this.emitState();
      return;
    }

    // Face detected
    this.faceDetected = true;
    this.lastFaceDetectedAt = now;
    this.cameraStatus = 'active';

    // Auto-resume if it was auto-paused
    if (this.isPaused && this.isAutoPaused) {
      this.resume();
      if (this.isTabVisible) {
        this.onAlert('info', 'Face detected. Resuming session.');
      }
    }

    if (this.isPaused) {
      this.emitState();
      return;
    }

    const landmarks = results.faceLandmarks[0];

    const frameGap = this.lastResultAt > 0 ? now - this.lastResultAt : 0;
    this.lastResultAt = now;
    const isBackground = !this.isTabVisible || !this.isWindowFocused;

    const blendshapes = (results as FaceLandmarkerBlendshapesResult).faceBlendshapes?.[0]?.categories ?? [];
    const eyeBlinkLeft = getBlendshapeScore(blendshapes, 'eyeBlinkLeft');
    const eyeBlinkRight = getBlendshapeScore(blendshapes, 'eyeBlinkRight');
    const pitch = calculateHeadPitch(landmarks);

    // DEBUG: Log key metrics periodically OR when a blink is potentially happening
    // Reject unstable frames
    if (
      pitch > 30 || pitch < -20 ||   // extreme angles
      !Number.isFinite(pitch)
    ) {
      this.trackingQuality = 'poor';
      this.emitState();
      return;
    }

    // Attention State Machine Classification
    let nextState: AttentionState = 'ATTENTIVE';

    if (!this.faceDetected) {
      nextState = 'FACE_LOST';
    } else if (pitch > 25) {
      nextState = 'LOOKING_DOWN';
    }

    if (nextState !== this.currentState) {
      if (this.pendingState !== nextState) {
        this.pendingState = nextState;
        this.stateHoldStart = now;
      }

      if (now - this.stateHoldStart > 800) {
        this.currentState = nextState;
      }
    } else {
      this.pendingState = nextState;
    }

    if (this.currentState !== 'ATTENTIVE') {
      this.trackingQuality = 'limited';
      // 🔥 CRITICAL: wipe ALL corrupted signals
      this.resetClosureTracking();
      this.eyeClosureHistory = [];
      this.perclosValue = 0;

      this.emitState();
      return;
    }
    
    this.unknownStateStartAt = 0;
    if (!this.evaluateFrameQuality(frameGap, isBackground, pitch, eyeBlinkLeft, eyeBlinkRight, landmarks)) {
      this.trackingQuality = 'poor';
      this.resetClosureTracking();
      this.emitState();
      return;
    }
    this.trackingQuality = 'good';

    // 🔥 MUCH more stable than EAR
    const eyesCurrentlyClosed = areEyesClosed(eyeBlinkLeft, eyeBlinkRight);

    if (eyesCurrentlyClosed) {
      this.openStateStartAt = 0;
      if (!this.eyesClosed) {
        // Eyes just closed
        this.eyesClosed = true;
        this.eyeClosedStart = now;
        this.closureSampleCount = 1;
        this.drowsinessCountedForCurrentClosure = false;
      } else {
        this.closureSampleCount += 1;
      }

      // Drowsiness detection
      const closedDuration = now - this.eyeClosedStart;
      if (
        closedDuration >= DROWSINESS_THRESHOLD_MS &&
        (!isBackground || this.closureSampleCount >= BACKGROUND_MIN_CLOSED_SAMPLES) &&
        (now - this.lastDrowsyEventAt >= DROWSY_EVENT_COOLDOWN_MS) &&
        !this.drowsinessCountedForCurrentClosure
      ) {
        this.longClosureEvents++;
        this.lastDrowsyEventAt = now;
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
          this.updatePERCLOS(now);
          this.emitState();
          return;
        }

        // Stability period passed, classify the closure event
        const closureDuration = this.openStateStartAt - this.eyeClosedStart;

        if (
          closureDuration >= 200 &&
          this.closureSampleCount >= (isBackground ? BACKGROUND_MIN_CLOSED_SAMPLES : 3) &&
          this.currentState === 'ATTENTIVE'
        ) {
          this.eyeClosureHistory.push({
            start: this.eyeClosedStart,
            end: this.openStateStartAt
          });
          this.recentClosures.push(now);
          this.recentClosures = this.recentClosures.filter(t => now - t < 10000);
        }
        
        if (closureDuration >= DROWSINESS_THRESHOLD_MS) {
          if (!this.drowsinessCountedForCurrentClosure) {
            const drowsySampleRequirementMet = !isBackground || this.closureSampleCount >= BACKGROUND_MIN_CLOSED_SAMPLES;
            const drowsyCooldownElapsed = now - this.lastDrowsyEventAt >= DROWSY_EVENT_COOLDOWN_MS;
            if (drowsySampleRequirementMet && drowsyCooldownElapsed) {
              this.longClosureEvents++;
              this.lastDrowsyEventAt = now;
              this.drowsinessCountedForCurrentClosure = true;
            }
          }
        } else if (
          closureDuration >= BLINK_MIN_MS &&
          closureDuration < DROWSINESS_THRESHOLD_MS &&
          now - this.lastBlinkAt >= BLINK_REFRACTORY_MS &&
          (!isBackground || this.closureSampleCount >= BACKGROUND_MIN_CLOSED_SAMPLES)
        ) {
          // Valid blink detected
          if (this.lastBlinkAt > 0) {
            const interval = now - this.lastBlinkAt;
            this.blinkIntervals.push(interval);
            if (this.blinkIntervals.length > 20) {
              this.blinkIntervals.shift();
            }
          }
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
    const oneMinuteAgo = now - 60000;
    this.blinkHistory = this.blinkHistory.filter(t => t > oneMinuteAgo);
    this.currentBlinkRate = this.blinkHistory.length;

    // Update PERCLOS
    this.updatePERCLOS(now);

    // Session average blink rate calculation moved to emitState for accurate paused time handling
    this.emitState();
  }

  private updatePERCLOS(now: number): void {
    const windowStart = now - PERCLOS_WINDOW_MS;
    
    // Clean up old history
    this.eyeClosureHistory = this.eyeClosureHistory.filter(event => event.end > windowStart);
    
    let totalClosedMs = 0;
    
    this.eyeClosureHistory.forEach(event => {
      const effectiveStart = Math.max(event.start, windowStart);
      totalClosedMs += (event.end - effectiveStart);
    });
    
    // If a closure is currently ongoing (or waiting for stability), add its duration
    if (this.eyesClosed) {
      const effectiveStart = Math.max(this.eyeClosedStart, windowStart);
      // If openStateStartAt > 0, the eye is open but we're waiting for stability.
      // The closure effectively ended at openStateStartAt.
      const effectiveEnd = this.openStateStartAt > 0 ? this.openStateStartAt : now;
      if (effectiveEnd > effectiveStart) {
        totalClosedMs += (effectiveEnd - effectiveStart);
      }
    }

    this.perclosValue = Math.min(
      (totalClosedMs / PERCLOS_WINDOW_MS) * 100,
      50 // hard cap
    );
  }

  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
      values.length;
    return Math.sqrt(variance);
  }

  private resetClosureTracking(): void {
    this.eyesClosed = false;
    this.eyeClosedStart = 0;
    this.closureSampleCount = 0;
    this.drowsinessCountedForCurrentClosure = false;
    this.openStateStartAt = 0;
  }

  private handleUnknownTrackingFrame(now: number): void {
    const noFaceDuration = now - this.lastFaceDetectedAt;
    const isBackground = !this.isTabVisible || !this.isWindowFocused;
    const autoPauseThreshold = isBackground ? AUTO_PAUSE_THRESHOLD_HIDDEN_MS : AUTO_PAUSE_THRESHOLD_MS;
    
    if (noFaceDuration >= autoPauseThreshold && !this.isPaused) {
      this.cameraStatus = 'covered';
      this.pause(true);
    }

    if (!this.eyesClosed) return;

    if (this.unknownStateStartAt === 0) {
      this.unknownStateStartAt = now;
    }

    if (
      isBackground &&
      now - this.unknownStateStartAt < UNKNOWN_FRAME_RESET_MS
    ) {
      return;
    }

    if (now - this.unknownStateStartAt >= UNKNOWN_FRAME_RESET_MS) {
      // Stop stale closed-state if tracking is lost for too long.
      this.resetClosureTracking();
      this.unknownStateStartAt = 0;
    }
    }

  private emitState(): void {
    const now = Date.now();
    const currentPauseDuration = this.isPaused ? (now - this.pauseStartAt) : 0;
    const effectiveElapsedMs = now - this.sessionStart - (this.totalPausedTime + currentPauseDuration);
    const sessionMinutes = Math.max(0, effectiveElapsedMs / 60000);

    const settings = this.getNotificationSettings();

    // Session average blink rate: smoothed denominator in first minute to avoid spikes.
    const normalizedMinutes = Math.max(sessionMinutes, 1);
    this.sessionAvgBlinkRate = sessionMinutes > 0
      ? Math.round(this.blinkCount / normalizedMinutes)
      : 0;

    // 🔥 Sigmoid-based PERCLOS Scaling
    function sigmoid(x: number): number {
      return 1 / (1 + Math.exp(-x));
    }
    const normalizedPerclos = this.perclosValue / 25;
    const perclosWeight = sigmoid((normalizedPerclos - 0.5) * 6) * 25;

    // 🔥 Absolute Blink Deficit (Training Goal)
    const referenceRate = settings.lowBlinkRate;

    const relativeDeficit = Math.max(
      0,
      (referenceRate - this.currentBlinkRate) / referenceRate
    );
    const blinkDeficit = relativeDeficit * 30;

    // 🔥 Blink Variability Penalty
    const stdDev = this.calculateStdDev(this.blinkIntervals);
    const variabilityPenalty = Math.min(stdDev / 2000, 1) * 15;

    // 🔥 Acute Closure Weight
    const acuteClosureWeight = Math.min(this.longClosureEvents * 5, 15);

    // 🔥 Exponential Duration Penalty
    const durationFactor = 1 - Math.exp(-sessionMinutes / 60);
    const durationPenalty = durationFactor * 20;

    // 🔥 Micro-Burst Detection
    const burstPenalty = Math.min(this.recentClosures.length * 3, 10);
    
    let rawFatigueScore = Math.min(
      100,
      Math.max(
        0,
        perclosWeight +
          blinkDeficit +
          variabilityPenalty +
          acuteClosureWeight +
          durationPenalty +
          burstPenalty
      )
    );

    // 🔥 Confidence Weighting
    let confidence = 1;
    if (this.currentState === 'LOOKING_DOWN') confidence = 0.3;
    if (this.currentState === 'FACE_LOST') confidence = 0;
    rawFatigueScore *= confidence;

    // 🔥 Momentum-based smoothing (physiological model)
    const adaptationRate = 0.05;

    // Update at most once per second to stay consistent with heartbeat
    if (now - this.lastFatigueSmoothAt >= 1000) {
      this.smoothedFatigueScore +=
        (rawFatigueScore - this.smoothedFatigueScore) * adaptationRate;
      
      // 🔥 Recovery condition
      if (
        this.perclosValue < 5 &&
        this.currentBlinkRate >= referenceRate &&
        this.longClosureEvents === 0
      ) {
        this.smoothedFatigueScore *= 0.97;
      }
      
      this.lastFatigueSmoothAt = now;
    }

    const fatigueScore = Math.round(this.smoothedFatigueScore);
    let fatigueLevel: FatigueState['fatigueLevel'] = 'Fresh';
    if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
    else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

    const alertIntervalMs = Math.max(1, settings.fatigueNotificationIntervalMinutes) * 60 * 1000;
    const shouldThrottle = this.lastFatigueAlertAt === 0 || now - this.lastFatigueAlertAt >= alertIntervalMs;

    if (shouldThrottle && !this.isPaused) {
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
      fatigueScore: fatigueScore,
      fatigueLevel,
      longClosureEvents: this.longClosureEvents,
      eyesOpen: !this.eyesClosed,
      sessionDurationMinutes: sessionMinutes,
      isRunning: this.running,
      isPaused: this.isPaused,
      isAutoPaused: this.isAutoPaused,
      faceDetected: this.faceDetected,
      cameraStatus: this.cameraStatus,
      lowBlinkRate: settings.lowBlinkRate,
      perclos: Math.round(this.perclosValue * 10) / 10,
      attentionState: this.currentState,
      trackingQuality: this.trackingQuality,
    });
  }

  stop(): SessionSummary {
    this.running = false;
    this.clearFrameLoopHandles();
    this.hiddenFrameLoopActive = false;
    
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    
    this.releaseWakeLock();
    this.stopCamera();

    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }

    const now = Date.now();
    const currentPauseDuration = this.isPaused ? (now - this.pauseStartAt) : 0;
    const effectiveElapsedMs = now - this.sessionStart - (this.totalPausedTime + currentPauseDuration);
    const sessionMinutes = Math.max(0, effectiveElapsedMs / 60000);

    const settings = this.getNotificationSettings();
    const lowBlinkRate = settings.lowBlinkRate;

    const blinkDeficit = sessionMinutes < 1
      ? 0
      : Math.max(0, (lowBlinkRate - this.currentBlinkRate) / lowBlinkRate) * 30;

    const perclosWeight = (this.perclosValue / 25) * 40;
    const acuteClosureWeight = Math.min(this.longClosureEvents * 5, 20);
    const closurePenalty = Math.min(perclosWeight + acuteClosureWeight, 80);
    const durationPenalty = Math.min(Math.max(sessionMinutes - 3, 0) / 120 * 20, 20);
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
      isPaused: this.isPaused,
      isAutoPaused: this.isAutoPaused,
      faceDetected: this.faceDetected,
      cameraStatus: this.cameraStatus,
      lowBlinkRate: lowBlinkRate,
      perclos: Math.round(this.perclosValue * 10) / 10,
      sessionDate: new Date().toISOString().split('T')[0],
    };
  }
}
