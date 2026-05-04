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
const processingCanvas = document.createElement('canvas');
const processingCtx = processingCanvas.getContext('2d', { willReadFrequently: true });
processingCanvas.width = 640;
processingCanvas.height = 480;

let earThreshold = DEFAULT_EAR_THRESHOLD;
let earCalibrationSamples = [];
const CALIBRATION_SAMPLES_REQUIRED = 30;
let openStateStartAt = 0;

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
  const v1 = Math.hypot(p[1].x - p[5].x, p[1].y - p[5].y);
  const v2 = Math.hypot(p[2].x - p[4].x, p[2].y - p[4].y);
  const h = Math.hypot(p[0].x - p[3].x, p[0].y - p[3].y);
  return (v1 + v2) / (2.0 * h);
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

function calculateFatigueScore(sessionMinutes, blinkRate) {
  if (sessionMinutes < 1) return 0;
  const blinkDeficit = Math.max(0, (8 - blinkRate) / 8) * 35;
  const closurePenalty = Math.min(longClosureEvents * 12, 36);
  const durationPenalty = Math.min(Math.max(sessionMinutes - 3, 0) / 120 * 40, 40);
  return Math.min(100, Math.max(0, blinkDeficit + closurePenalty + durationPenalty));
}

function buildSessionData() {
  const now = Date.now();
  const durationMinutes = sessionStartTime ? (now - sessionStartTime) / 60000 : 0;
  const oneMinuteAgo = now - 60000;
  blinkHistory = blinkHistory.filter((t) => t > oneMinuteAgo);
  const currentBlinkRate = blinkHistory.length;
  const sessionAvgBlinkRate = durationMinutes > 0 ? Math.round(blinkCount / Math.max(durationMinutes, 1)) : 0;
  const fatigueScore = Math.round(calculateFatigueScore(durationMinutes, currentBlinkRate));

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
    sessionDurationMinutes: Math.round(durationMinutes * 10) / 10,
  };
}

function resetSessionCounters() {
  blinkCount = 0;
  longClosureEvents = 0;
  blinkHistory = [];
  lastBlinkTime = 0;
  eyesClosed = false;
  eyeClosedStart = 0;
  openStateStartAt = 0;
  earThreshold = DEFAULT_EAR_THRESHOLD;
  earCalibrationSamples = [];
  unknownStateStartAt = 0;
  lastResultAt = 0;
  closureSampleCount = 0;
}

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

    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });

    if (!isStarting) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    cameraStream = stream;
    cameraTrack = stream.getVideoTracks()[0] || null;
    videoElement.srcObject = stream;
    sessionActive = true;
    sessionStartTime = Date.now();
    resetSessionCounters();
    
    closeHiddenTrackReader();
    ensureHiddenCaptureProviders();

    videoElement.onloadedmetadata = () => {
      if (!sessionActive) { stream.getTracks().forEach(t => t.stop()); return; }
      videoElement.play();
      updateInterval = setInterval(() => {
        if (!sessionActive) return;
        chrome.runtime.sendMessage({ action: 'monitorMetrics', data: buildSessionData() }).catch(() => undefined);
      }, 1000);
      chrome.runtime.sendMessage({ action: 'monitorStarted', data: buildSessionData() }).catch(() => undefined);
      processFrame();
    };
  } catch (err) {
    sessionActive = false;
  } finally {
    isStarting = false;
  }
}

function handleUnknownTrackingFrame(now) {
  if (!eyesClosed) return;
  if (unknownStateStartAt === 0) unknownStateStartAt = now;

  const isBackground = !isTabVisible;
  if (isBackground && (now - unknownStateStartAt < UNKNOWN_FRAME_RESET_MS)) return;

  const closedDuration = now - eyeClosedStart;
  if (closedDuration >= DROWSINESS_THRESHOLD_MS) {
    longClosureEvents += 1;
  }

  if (now - unknownStateStartAt >= UNKNOWN_FRAME_RESET_MS) {
    eyesClosed = false;
    eyeClosedStart = 0;
    unknownStateStartAt = 0;
    closureSampleCount = 0;
  }
}

function onFaceLandmarkerResults(results) {
  const now = Date.now();
  if (!sessionActive || !results?.faceLandmarks || results.faceLandmarks.length === 0) {
    handleUnknownTrackingFrame(now);
    return;
  }

  unknownStateStartAt = 0;
  const frameGap = lastResultAt > 0 ? now - lastResultAt : 0;
  lastResultAt = now;

  const landmarks = results.faceLandmarks[0];
  const avgEAR = (computeEAR(landmarks, LEFT_EYE) + computeEAR(landmarks, RIGHT_EYE)) / 2;

  if (earCalibrationSamples.length < CALIBRATION_SAMPLES_REQUIRED) {
    updateEARCalibration(avgEAR);
  }

  const eyesCurrentlyClosed = avgEAR < earThreshold;
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
        longClosureEvents += 1;
      } else if (closedDuration >= BLINK_MIN_MS) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          blinkCount += 1;
          blinkHistory.push(now);
          lastBlinkTime = now;
        }
      }
      eyesClosed = false;
      closureSampleCount = 0;
      openStateStartAt = 0;
    }
  }
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

  if (cameraStream) {
    cameraStream.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) {} });
    cameraStream = null;
  }
  if (cameraTrack) { try { cameraTrack.stop(); } catch(e) {} cameraTrack = null; }

  closeHiddenTrackReader();
  imageCapture = null;

  if (videoElement) {
    try {
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.load();
    } catch (e) {}
  }

  if (faceLandmarker) {
    try { faceLandmarker.close(); } catch (e) {}
    faceLandmarker = null;
  }

  try { chrome.runtime.sendMessage({ action: 'monitorStopped', data: buildSessionData() }).catch(() => undefined); } catch (e) {}
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'start') startSession();
  else if (message?.action === 'stop') stopSession();
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

