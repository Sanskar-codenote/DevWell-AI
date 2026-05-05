import { FaceLandmarker, FilesetResolver } from './lib/vision_bundle.js';

const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const DEFAULT_EAR_THRESHOLD = 0.21;
const BLINK_MIN_MS = 50;
const DROWSINESS_THRESHOLD_MS = 1500;
const BLINK_REFRACTORY_MS = 80;
const REOPEN_STABILITY_MS = 90;
const HIDDEN_READER_TIMEOUT_MS = 280;
const HIDDEN_GRAB_TIMEOUT_MS = 280;
const HIDDEN_LOOP_INTERVAL_MS = 150; 
const VISIBLE_FRAME_INTERVAL_MS = 100;
const UNKNOWN_FRAME_RESET_MS = 2500;
const BACKGROUND_SPARSE_GAP_MS = 700;
const PERCLOS_WINDOW_MS = 60000;

let sessionActive = false;
let isStarting = false;
let sessionStartTime = null;
let blinkCount = 0;
let longClosureEvents = 0;
let blinkHistory = [];
let lastBlinkTime = 0;
let eyesClosed = false;
let eyeClosedStart = 0;
let cameraStream = null;
let cameraTrack = null;
let videoElement = document.getElementById('webcam');
let faceLandmarker = null;
let updateInterval = null;
let rafId = null;
let imageCapture = null;
let hiddenFrameReader = null;
let hiddenFrameLoopActive = false;
let isTabVisible = document.visibilityState === 'visible';
let unknownStateStartAt = 0;
let lastResultAt = 0;
let closureSampleCount = 0;
let isPaused = false;
let isAutoPaused = false;
let totalPausedTime = 0;
let pauseStartAt = 0;
let faceDetected = false;
let drowsinessCounted = false;
let cameraStatus = 'inactive';
let lastFaceDetectedAt = 0;
const processingCanvas = document.createElement('canvas');
const processingCtx = processingCanvas.getContext('2d', { willReadFrequently: true });
processingCanvas.width = 640;
processingCanvas.height = 480;

const AUTO_PAUSE_THRESHOLD_MS = 20000;

let earThreshold = DEFAULT_EAR_THRESHOLD;
let lowBlinkRate = 15;
let earCalibrationSamples = [];
const CALIBRATION_SAMPLES_REQUIRED = 30;
let openStateStartAt = 0;
let perclosValue = 0;
let eyeClosureHistory = [];

document.addEventListener('visibilitychange', () => {
  const wasVisible = isTabVisible;
  isTabVisible = document.visibilityState === 'visible';
  if (!sessionActive) return;

  if (isTabVisible && !wasVisible) {
    clearFrameLoopHandles();
    processFrame();
  } else if (!isTabVisible) {
    ensureHiddenCaptureProviders();
    clearFrameLoopHandles();
    scheduleNextFrame();
  }
});

function computeEAR(landmarks, eyeIndices) {
  const p = eyeIndices.map((i) => landmarks[i]);
  const dist3d = (p1, p2) => 
    Math.hypot(p1.x - p2.x, p1.y - p2.y, (p1.z || 0) - (p2.z || 0));

  const v1 = dist3d(p[1], p[5]);
  const v2 = dist3d(p[2], p[4]);
  const h = dist3d(p[0], p[3]);
  return (v1 + v2) / (2.0 * h);
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) {} });
    cameraStream = null;
  }
  if (cameraTrack) { try { cameraTrack.stop(); } catch(e) {} cameraTrack = null; }
  closeHiddenTrackReader();
  imageCapture = null;
  if (videoElement) {
    try { videoElement.pause(); videoElement.srcObject = null; videoElement.load(); } catch (e) {}
  }
  cameraStatus = 'inactive';
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
  });
  cameraStream = stream;
  cameraTrack = stream.getVideoTracks()[0] || null;
  videoElement.srcObject = stream;
  ensureHiddenCaptureProviders();
  cameraStatus = 'active';
  return new Promise(resolve => {
    videoElement.onloadedmetadata = () => {
      videoElement.play();
      resolve();
    };
  });
}

function updateEARCalibration(avgEAR) {
  if (earCalibrationSamples.length < CALIBRATION_SAMPLES_REQUIRED) {
    earCalibrationSamples.push(avgEAR);
    if (earCalibrationSamples.length === CALIBRATION_SAMPLES_REQUIRED) {
      const avg = earCalibrationSamples.reduce((a, b) => a + b, 0) / CALIBRATION_SAMPLES_REQUIRED;
      earThreshold = Math.max(0.16, Math.min(0.25, avg * 0.7));
    }
  }
}

function pauseSession(isAuto = false) {
  if (!sessionActive || isPaused) return;
  isPaused = true;
  isAutoPaused = isAuto;
  pauseStartAt = Date.now();
  if (!isAuto) {
    stopCamera();
  }
  chrome.runtime.sendMessage({ action: 'monitorMetrics', data: buildSessionData() }).catch(() => undefined);
}

async function resumeSession() {
  if (!sessionActive || !isPaused) return;
  const wasAutoPaused = isAutoPaused;
  isPaused = false;
  isAutoPaused = false;

  if (!wasAutoPaused) {
    try {
      await startCamera();
    } catch(err) {
      pauseSession(false);
      return;
    }
  }

  if (pauseStartAt > 0) {
    totalPausedTime += Date.now() - pauseStartAt;
    pauseStartAt = 0;
  }
  chrome.runtime.sendMessage({ action: 'monitorMetrics', data: buildSessionData() }).catch(() => undefined);
}

function calculateFatigueScore(sessionMinutes, blinkRate) {
  if (sessionMinutes < 1) return 0;
  const blinkDeficit = Math.max(0, (lowBlinkRate - blinkRate) / lowBlinkRate) * 30;
  
  const perclosWeight = (perclosValue / 15) * 60;
  const acuteClosureWeight = Math.min(longClosureEvents * 5, 20);
  const closurePenalty = Math.min(perclosWeight + acuteClosureWeight, 80);
  
  const durationPenalty = Math.min(Math.max(sessionMinutes - 3, 0) / 120 * 20, 20);
  return Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));
}

function buildSessionData() {
  const now = Date.now();
  const currentPauseDuration = isPaused ? (now - pauseStartAt) : 0;
  const effectiveElapsedMs = now - sessionStartTime - (totalPausedTime + currentPauseDuration);
  const durationMinutes = sessionStartTime ? Math.max(0, effectiveElapsedMs / 60000) : 0;
  
  const oneMinuteAgo = now - 60000;
  blinkHistory = blinkHistory.filter((t) => t > oneMinuteAgo);
  const currentBlinkRate = blinkHistory.length;
  
  const normalizedMinutes = Math.max(durationMinutes, 1);
  const sessionAvgBlinkRate = durationMinutes > 0 ? Math.round(blinkCount / normalizedMinutes) : 0;
  
  const effectiveBlinkRate = currentBlinkRate > 0 ? currentBlinkRate : sessionAvgBlinkRate;
  const fatigueScore = Math.round(calculateFatigueScore(durationMinutes, effectiveBlinkRate));

  let fatigueLevel = 'Fresh';
  if (fatigueScore > 70) fatigueLevel = 'High Fatigue';
  else if (fatigueScore > 40) fatigueLevel = 'Moderate Fatigue';

  return {
    blinkCount,
    currentBlinkRate,
    sessionAvgBlinkRate,
    fatigueScore,
    fatigueLevel,
    longClosureEvents,
    sessionDurationMinutes: durationMinutes,
    lowBlinkRate,
    isPaused,
    isAutoPaused,
    totalPausedTime,
    pauseStartAt,
    faceDetected,
    cameraStatus,
    eyesOpen: !eyesClosed,
    perclos: Math.round(perclosValue * 10) / 10,
  };
}

function updatePERCLOS(now) {
  const windowStart = now - PERCLOS_WINDOW_MS;
  eyeClosureHistory = eyeClosureHistory.filter(event => event.end > windowStart);
  
  let totalClosedMs = 0;
  eyeClosureHistory.forEach(event => {
    const effectiveStart = Math.max(event.start, windowStart);
    totalClosedMs += (event.end - effectiveStart);
  });
  
  if (eyesClosed) {
    const effectiveStart = Math.max(eyeClosedStart, windowStart);
    totalClosedMs += (now - effectiveStart);
  }
  
  perclosValue = (totalClosedMs / PERCLOS_WINDOW_MS) * 100;
}

// Moved to the bottom of the file

function clearFrameLoopHandles() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function createHiddenTrackReader(track) {
  if (!track || typeof MediaStreamTrackProcessor === 'undefined') return null;
  try {
    const processor = new MediaStreamTrackProcessor({ track });
    return processor.readable.getReader();
  } catch (err) { return null; }
}

function closeHiddenTrackReader() {
  const reader = hiddenFrameReader;
  hiddenFrameReader = null;
  if (!reader) return;
  try {
    reader.releaseLock?.();
    reader.cancel?.().catch(() => undefined);
  } catch (e) {}
}

function ensureHiddenCaptureProviders() {
  if (!cameraTrack) return;
  if (!hiddenFrameReader) hiddenFrameReader = createHiddenTrackReader(cameraTrack);
  if (!imageCapture && typeof ImageCapture !== 'undefined') {
    try { imageCapture = new ImageCapture(cameraTrack); } catch (err) { imageCapture = null; }
  }
}

function scheduleNextFrame() {
  if (!sessionActive) return;
  clearFrameLoopHandles();
  if (!isTabVisible) {
    ensureHiddenCaptureProviders();
    if (!hiddenFrameLoopActive) void runHiddenFrameLoop();
  } else {
    rafId = requestAnimationFrame(processFrame);
  }
}

async function runHiddenFrameLoop() {
  if (hiddenFrameLoopActive || !sessionActive || isTabVisible) return;
  hiddenFrameLoopActive = true;

  try {
    while (sessionActive && !isTabVisible) {
      const loopStart = performance.now();
      ensureHiddenCaptureProviders();
      let detected = false;

      if (hiddenFrameReader) {
        try {
          const frame = await Promise.race([
            hiddenFrameReader.read(),
            new Promise((resolve) => setTimeout(() => resolve({ done: true }), HIDDEN_READER_TIMEOUT_MS)),
          ]);
          if (!frame.done && frame.value) {
            const videoFrame = frame.value;
            try {
              processingCtx.drawImage(videoFrame, 0, 0, processingCanvas.width, processingCanvas.height);
              onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
              detected = true;
            } finally { videoFrame.close?.(); }
          } else { closeHiddenTrackReader(); }
        } catch (err) { closeHiddenTrackReader(); }
      }

      if (!detected && imageCapture) {
        try {
          const bitmap = await Promise.race([
            imageCapture.grabFrame(),
            new Promise((resolve) => setTimeout(() => resolve(null), HIDDEN_GRAB_TIMEOUT_MS)),
          ]);
          if (bitmap) {
            try {
              processingCtx.drawImage(bitmap, 0, 0, processingCanvas.width, processingCanvas.height);
              onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
              detected = true;
            } finally { bitmap.close(); }
          } else { imageCapture = null; }
        } catch (err) { imageCapture = null; }
      }

      if (!detected && videoElement.readyState >= 2) {
        processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
        onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
        detected = true;
      }

      if (!detected) {
        const processingTime = performance.now() - loopStart;
        const delay = Math.max(10, HIDDEN_LOOP_INTERVAL_MS - processingTime);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Yield to let other async tasks run
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  } finally {
    hiddenFrameLoopActive = false;
    if (sessionActive && isTabVisible) scheduleNextFrame();
  }
}

async function startSession() {
  if (sessionActive || isStarting) return;
  isStarting = true;

  try {
    const settingsResult = await chrome.storage.local.get(['extensionSettings', 'websiteSettings']);
    const settings = settingsResult.extensionSettings || settingsResult.websiteSettings || {};
    lowBlinkRate = Number(settings.lowBlinkRate || 15);

    if (!faceLandmarker) {
      const filesetResolver = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('lib/wasm'));
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('lib/face_landmarker.task'),
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true
      });
    }

    if (!isStarting) return;

    if (cameraStream) stopCamera();

    await startCamera();

    if (!isStarting) {
      stopCamera();
      return;
    }

    sessionActive = true;
    sessionStartTime = Date.now();
    isPaused = false;
    isAutoPaused = false;
    totalPausedTime = 0;
    pauseStartAt = 0;
    faceDetected = false;
    lastFaceDetectedAt = Date.now();
    resetSessionCounters();

    updateInterval = setInterval(() => {
      if (!sessionActive) return;
      chrome.runtime.sendMessage({ action: 'monitorMetrics', data: buildSessionData() }).catch(() => undefined);
    }, 1000);
    chrome.runtime.sendMessage({ action: 'monitorStarted', data: buildSessionData() }).catch(() => undefined);
    processFrame();
  } catch (err) {
    sessionActive = false;
  } finally {
    isStarting = false;
  }
}

function resetSessionCounters() {
  blinkCount = 0;
  longClosureEvents = 0;
  blinkHistory = [];
  lastBlinkTime = 0;
  earThreshold = DEFAULT_EAR_THRESHOLD;
  earCalibrationSamples = [];
  lastResultAt = 0;
  resetClosureTracking();
}

function resetClosureTracking() {
  eyesClosed = false;
  eyeClosedStart = 0;
  closureSampleCount = 0;
  drowsinessCounted = false;
  openStateStartAt = 0;
  unknownStateStartAt = 0;
}

function handleUnknownTrackingFrame(now) {
  const noFaceDuration = now - lastFaceDetectedAt;
  if (noFaceDuration >= AUTO_PAUSE_THRESHOLD_MS && !isPaused) {
    cameraStatus = 'covered';
    pauseSession(true);
  }

  if (!eyesClosed) return;
  if (unknownStateStartAt === 0) unknownStateStartAt = now;

  const isBackground = !isTabVisible;
  if (isBackground && (now - unknownStateStartAt < UNKNOWN_FRAME_RESET_MS)) return;

  if (now - unknownStateStartAt >= UNKNOWN_FRAME_RESET_MS) {
    resetClosureTracking();
  }
}

const MAX_EYE_ASYMMETRY_RATIO = 1.8;
const MIN_VALID_EYE_WIDTH = 0.018;
const MIN_PITCH_RATIO = 0.40;

function onFaceLandmarkerResults(results) {
  const now = Date.now();
  if (!sessionActive) return;

  if (!results?.faceLandmarks || results.faceLandmarks.length === 0) {
    faceDetected = false;
    handleUnknownTrackingFrame(now);
    return;
  }

  faceDetected = true;
  lastFaceDetectedAt = now;
  cameraStatus = 'active';

  if (isPaused && isAutoPaused) {
    resumeSession();
  }

  if (isPaused) {
    return;
  }

  const landmarks = results.faceLandmarks[0];
  
  // Pose reliability check
  const leftEyeWidth = Math.hypot(landmarks[LEFT_EYE[0]].x - landmarks[LEFT_EYE[3]].x, landmarks[LEFT_EYE[0]].y - landmarks[LEFT_EYE[3]].y);
  const rightEyeWidth = Math.hypot(landmarks[RIGHT_EYE[0]].x - landmarks[RIGHT_EYE[3]].x, landmarks[RIGHT_EYE[0]].y - landmarks[RIGHT_EYE[3]].y);
  const minEyeWidth = Math.min(leftEyeWidth, rightEyeWidth);
  const maxEyeWidth = Math.max(leftEyeWidth, rightEyeWidth);
  const eyeAsymmetryRatio = maxEyeWidth / Math.max(minEyeWidth, 1e-6);
  
  // Pitch detection (looking down at keyboard)
  const eyeCenterY = (landmarks[LEFT_EYE[0]].y + landmarks[RIGHT_EYE[0]].y) / 2;
  const noseTipY = landmarks[4].y;
  const mouthY = landmarks[13].y; // Upper lip inner
  const headPitchRatio = (noseTipY - eyeCenterY) / Math.max(mouthY - eyeCenterY, 1e-6);

  if (minEyeWidth < MIN_VALID_EYE_WIDTH || eyeAsymmetryRatio > MAX_EYE_ASYMMETRY_RATIO || headPitchRatio < MIN_PITCH_RATIO) {
    if (eyesClosed) {
      resetClosureTracking();
    }
    handleUnknownTrackingFrame(now);
    return;
  }

  unknownStateStartAt = 0;
  const frameGap = lastResultAt > 0 ? now - lastResultAt : 0;
  lastResultAt = now;

  const leftEAR = computeEAR(landmarks, LEFT_EYE);
  const rightEAR = computeEAR(landmarks, RIGHT_EYE);
  const avgEAR = (leftEAR + rightEAR) / 2;

  if (earCalibrationSamples.length < CALIBRATION_SAMPLES_REQUIRED) {
    updateEARCalibration(avgEAR);
  }

  // Symmetry check for closing
  const eyesCurrentlyClosed = avgEAR < earThreshold && Math.max(leftEAR, rightEAR) < earThreshold * 1.08;
  const isBackground = !isTabVisible;

  if (eyesCurrentlyClosed) {
    openStateStartAt = 0;
    if (!eyesClosed) {
      eyesClosed = true;
      eyeClosedStart = now;
      closureSampleCount = 1;
    } else {
      closureSampleCount += 1;
    }
  } else if (!eyesCurrentlyClosed && eyesClosed) {
    if (openStateStartAt === 0) openStateStartAt = now;
    const stableEnough = (now - openStateStartAt >= REOPEN_STABILITY_MS) || isBackground;
    
    if (stableEnough) {
      // Record for PERCLOS
      eyeClosureHistory.push({ start: eyeClosedStart, end: now });

      const closedDuration = now - eyeClosedStart;
      
      const sparseBackgroundClosure = isBackground && 
        closedDuration >= DROWSINESS_THRESHOLD_MS && 
        closureSampleCount <= 2 && 
        frameGap >= BACKGROUND_SPARSE_GAP_MS;

      if (sparseBackgroundClosure) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          blinkCount += 1;
          blinkHistory.push(now);
          lastBlinkTime = now;
        }
      } else if (closedDuration >= DROWSINESS_THRESHOLD_MS) {
        if (!drowsinessCounted) {
          longClosureEvents += 1;
          drowsinessCounted = true;
        }
      } 

      if (closedDuration >= BLINK_MIN_MS && closedDuration < DROWSINESS_THRESHOLD_MS) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          // If tab is backgrounded, require more closure samples to confirm a blink
          if (!isBackground || closureSampleCount >= 3) {
            blinkCount += 1;
            blinkHistory.push(now);
            lastBlinkTime = now;
          }
        }
      }

      resetClosureTracking();
    }
  }
  updatePERCLOS(now);
}

let lastVideoTime = -1;
async function processFrame() {
  if (!sessionActive || !isTabVisible) {
    if (sessionActive) scheduleNextFrame();
    return;
  }

  const now = performance.now();
  if (videoElement.readyState >= 2) {
    if (now - lastVideoTime >= VISIBLE_FRAME_INTERVAL_MS) {
      lastVideoTime = now;
      processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
      try { onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, now)); } catch (err) {}
    }
  }
  scheduleNextFrame();
}

/**
 * INVINCIBLE CLEANUP - Kills media tracks and releases hardware locks
 */
function stopSession() {
  if (!sessionActive && !isStarting) return;
  sessionActive = false;
  isStarting = false;

  if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  hiddenFrameLoopActive = false;

  stopCamera();

  if (faceLandmarker) {
    try { faceLandmarker.close(); } catch (e) {}
    faceLandmarker = null;
  }

  try { chrome.runtime.sendMessage({ action: 'monitorStopped', data: buildSessionData() }).catch(() => undefined); } catch (e) {}
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'start') startSession();
  else if (message?.action === 'stop') stopSession();
  else if (message?.action === 'pause') pauseSession();
  else if (message?.action === 'resume') resumeSession();
});

// SELF-DESTRUCT MECHANISMS
try {
  const port = chrome.runtime.connect({ name: 'monitor-connection' });
  port.onDisconnect.addListener(() => {
    stopSession();
    setTimeout(() => window.close(), 100);
  });
} catch (e) {}

setInterval(() => {
  try {
    if (!chrome.runtime?.id || !chrome.runtime.getManifest()) {
      stopSession();
      window.close();
    }
  } catch (e) {
    stopSession();
    window.close();
  }
}, 1000);

window.addEventListener('beforeunload', stopSession);

