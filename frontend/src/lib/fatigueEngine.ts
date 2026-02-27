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

const EAR_THRESHOLD = 0.21;
const BLINK_CONSECUTIVE_FRAMES = 2;
const DROWSINESS_THRESHOLD_MS = 1500;
const LOW_BLINK_RATE = 8;
const BREAK_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

export class FatigueEngine {
  private faceMesh: any = null;
  private camera: any = null;
  private videoElement: HTMLVideoElement | null = null;
  private onFatigueUpdate: FatigueCallback;
  private onAlert: AlertCallback;

  private blinkCount = 0;
  private blinkFrameCounter = 0;
  private eyesClosed = false;
  private eyeClosedStart = 0;
  private longClosureEvents = 0;
  private blinksPerMinute = 0;
  private blinkHistory: number[] = [];
  private sessionStart = 0;
  private lastBreakAlert = 0;
  private animationFrameId: number | null = null;
  private running = false;
  private lastDrowsinessAlert = 0;

  constructor(onUpdate: FatigueCallback, onAlert: AlertCallback) {
    this.onFatigueUpdate = onUpdate;
    this.onAlert = onAlert;
  }

  async start(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;
    this.sessionStart = Date.now();
    this.lastBreakAlert = Date.now();
    this.blinkCount = 0;
    this.longClosureEvents = 0;
    this.blinkHistory = [];
    this.running = true;

    // Load FaceMesh via CDN
    const FaceMesh = (window as any).FaceMesh;
    if (!FaceMesh) {
      throw new Error('MediaPipe FaceMesh not loaded. Ensure the CDN scripts are included.');
    }

    this.faceMesh = new FaceMesh({
      locateFile: (file: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    this.faceMesh.onResults((results: any) => this.processResults(results));
    await this.faceMesh.initialize();

    // Start camera
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    videoElement.srcObject = stream;
    await videoElement.play();

    this.processFrame();
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

    const now = Date.now();
    const eyesCurrentlyClosed = avgEAR < EAR_THRESHOLD;

    if (eyesCurrentlyClosed) {
      this.blinkFrameCounter++;

      if (!this.eyesClosed) {
        this.eyesClosed = true;
        this.eyeClosedStart = now;
      }

      // Drowsiness detection
      const closedDuration = now - this.eyeClosedStart;
      if (closedDuration > DROWSINESS_THRESHOLD_MS && now - this.lastDrowsinessAlert > 5000) {
        this.longClosureEvents++;
        this.lastDrowsinessAlert = now;
        this.onAlert('drowsiness', 'Drowsiness detected! Your eyes have been closed for an extended period.');
      }
    } else {
      if (this.blinkFrameCounter >= BLINK_CONSECUTIVE_FRAMES) {
        this.blinkCount++;
        this.blinkHistory.push(now);
      }
      this.blinkFrameCounter = 0;
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
      sessionDurationMinutes: parseFloat(sessionMinutes.toFixed(1)),
      isRunning: this.running,
    });
  }

  stop(): FatigueState & { sessionDate: string } {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
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
