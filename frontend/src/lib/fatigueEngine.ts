// Fatigue detection engine using MediaPipe FaceMesh
// All processing happens client-side for privacy

export interface FatigueState {
  blinkCount: number;
  blinksPerMinute: number;
  fatigueScore: number;
  fatigueLevel: 'Fresh' | 'Moderate Fatigue' | 'High Fatigue';
  longClosureEvents: number;
  eyesOpen: boolean;
  sessionDurationMinutes: number;
  isRunning: boolean;
}

type FatigueCallback = (state: FatigueState) => void;
type AlertCallback = (type: 'blink_rate' | 'drowsiness' | 'break', message: string) => void;

// Eye Aspect Ratio calculation using 6 landmark points per eye
function computeEAR(landmarks: any[], eyeIndices: number[]): number {
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
const EAR_OPEN_FRACTION = 0.74; // Eye-closed threshold as a fraction of calibrated open-eye EAR
const BLINK_MIN_MS = 90;
const BLINK_MAX_MS = 500;
const DROWSINESS_THRESHOLD_MS = 1200;
const LOW_BLINK_RATE = 8;
const BREAK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

export class FatigueEngine {
  private faceMesh: any = null;
  private videoElement: HTMLVideoElement | null = null;
  private onFatigueUpdate: FatigueCallback;
  private onAlert: AlertCallback;

  private blinkCount = 0;
  private eyesClosed = false;
  private eyeClosedStart = 0;
  private drowsinessCountedForCurrentClosure = false;
  private longClosureEvents = 0;
  private blinksPerMinute = 0;
  private blinkHistory: number[] = [];
  private sessionStart = 0;
  private lastBreakAlert = 0;
  private animationFrameId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private running = false;
  private lastDrowsinessAlert = 0;
  private earThreshold = DEFAULT_EAR_THRESHOLD;
  private openEARBaseline = 0;
  private earCalibrationSamples: number[] = [];
  private calibrationStartedAt = 0;

  constructor(onUpdate: FatigueCallback, onAlert: AlertCallback) {
    this.onFatigueUpdate = onUpdate;
    this.onAlert = onAlert;
  }

  async start(videoElement: HTMLVideoElement): Promise<void> {
    console.log('FatigueEngine.start() called with video element:', videoElement);
    try {
      this.videoElement = videoElement;
      this.sessionStart = Date.now();
      this.lastBreakAlert = Date.now();
      this.blinkCount = 0;
      this.longClosureEvents = 0;
      this.blinkHistory = [];
      this.running = true;
      this.earThreshold = DEFAULT_EAR_THRESHOLD;
      this.openEARBaseline = 0;
      this.earCalibrationSamples = [];
      this.calibrationStartedAt = Date.now();
      console.log('Engine state initialized');

      // Load FaceMesh via CDN
      console.log('Checking for FaceMesh library...');
      const FaceMesh = (window as any).FaceMesh;
      console.log('FaceMesh found:', !!FaceMesh);
      
      // Wait for FaceMesh to load if not available immediately
      if (!FaceMesh) {
        console.log('FaceMesh not available, waiting for it to load...');
        await new Promise<void>((resolve, reject) => {
          let attempts = 0;
          const maxAttempts = 50; // 5 seconds with 100ms intervals
          const checkInterval = setInterval(() => {
            attempts++;
            const fm = (window as any).FaceMesh;
            if (fm) {
              console.log(`FaceMesh loaded after ${attempts * 100}ms`);
              clearInterval(checkInterval);
              resolve();
            } else if (attempts >= maxAttempts) {
              console.error('FaceMesh failed to load after timeout');
              clearInterval(checkInterval);
              reject(new Error('MediaPipe FaceMesh failed to load. Please check your internet connection and refresh the page.'));
            }
          }, 100);
        });
      }

      console.log('Creating FaceMesh instance...');
      const FaceMeshFinal = (window as any).FaceMesh;
      this.faceMesh = new FaceMeshFinal({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      console.log('FaceMesh instance created');

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.faceMesh.onResults((results: any) => {
        console.log('Processing results...');
        this.processResults(results);
      });
      console.log('FaceMesh options set and results handler registered');
      
      await this.faceMesh.initialize();
      console.log('FaceMesh initialized');

      // Start camera
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      console.log('Camera stream obtained:', stream);
      videoElement.srcObject = stream;
      console.log('Video element srcObject set');
      
      await videoElement.play();
      console.log('Video element playing');

      this.processFrame();
      this.startHeartbeat();
      console.log('Process frame started');
    } catch (error) {
      console.error('Error in FatigueEngine.start():', error);
      console.error('Error stack:', (error as Error).stack);
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

  private processResults(results: any): void {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.emitState();
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const leftEAR = computeEAR(landmarks, LEFT_EYE);
    const rightEAR = computeEAR(landmarks, RIGHT_EYE);
    const avgEAR = (leftEAR + rightEAR) / 2;
    this.updateEARCalibration(avgEAR);

    const now = Date.now();
    const eyesCurrentlyClosed = avgEAR < this.earThreshold;

    if (eyesCurrentlyClosed) {
      if (!this.eyesClosed) {
        this.eyesClosed = true;
        this.eyeClosedStart = now;
        this.drowsinessCountedForCurrentClosure = false;
      }

      // Drowsiness detection
      const closedDuration = now - this.eyeClosedStart;
      if (
        closedDuration >= DROWSINESS_THRESHOLD_MS &&
        !this.drowsinessCountedForCurrentClosure &&
        now - this.lastDrowsinessAlert > 5000
      ) {
        this.longClosureEvents++;
        this.drowsinessCountedForCurrentClosure = true;
        this.lastDrowsinessAlert = now;
        this.onAlert('drowsiness', 'Drowsiness detected! Your eyes have been closed for an extended period.');
      }
    } else {
      // Classify a completed eye-closure event by duration.
      if (this.eyesClosed) {
        const closureDuration = now - this.eyeClosedStart;
        if (closureDuration >= BLINK_MIN_MS && closureDuration <= BLINK_MAX_MS) {
          this.blinkCount++;
          this.blinkHistory.push(now);
        }
        this.eyeClosedStart = 0;
        this.drowsinessCountedForCurrentClosure = false;
      }
      this.eyesClosed = false;
    }

    // Calculate blinks per minute (rolling 60s window)
    const oneMinuteAgo = now - 60000;
    this.blinkHistory = this.blinkHistory.filter(t => t > oneMinuteAgo);
    this.blinksPerMinute = this.blinkHistory.length;

    // Low blink rate alert
    const sessionMinutes = (now - this.sessionStart) / 60000;
    if (sessionMinutes > 1 && this.blinksPerMinute < LOW_BLINK_RATE && this.blinksPerMinute > 0) {
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

  private emitState(): void {
    const now = Date.now();
    const sessionMinutes = (now - this.sessionStart) / 60000;

    // Fatigue score calculation (0-100)
    const blinkDeficit = Math.max(0, (LOW_BLINK_RATE - this.blinksPerMinute) / LOW_BLINK_RATE) * 35;
    const closurePenalty = Math.min(this.longClosureEvents * 10, 30);
    const durationPenalty = Math.min(sessionMinutes / 180 * 35, 35);
    const fatigueScore = Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));

    let fatigueLevel: FatigueState['fatigueLevel'] = 'Fresh';
    if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
    else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

    this.onFatigueUpdate({
      blinkCount: this.blinkCount,
      blinksPerMinute: this.blinksPerMinute,
      fatigueScore: Math.round(fatigueScore),
      fatigueLevel,
      longClosureEvents: this.longClosureEvents,
      eyesOpen: !this.eyesClosed,
      sessionDurationMinutes: sessionMinutes,
      isRunning: this.running,
    });
  }

  stop(): FatigueState & { sessionDate: string } {
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
    const blinkDeficit = Math.max(0, (LOW_BLINK_RATE - this.blinksPerMinute) / LOW_BLINK_RATE) * 35;
    const closurePenalty = Math.min(this.longClosureEvents * 10, 30);
    const durationPenalty = Math.min(sessionMinutes / 180 * 35, 35);
    const fatigueScore = Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));

    let fatigueLevel: FatigueState['fatigueLevel'] = 'Fresh';
    if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
    else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

    return {
      blinkCount: this.blinkCount,
      blinksPerMinute: this.blinksPerMinute,
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
