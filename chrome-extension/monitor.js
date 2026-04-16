import { FaceLandmarker, FilesetResolver } from './lib/vision_bundle.js';

const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const DEFAULT_EAR_THRESHOLD = 0.21;
const BLINK_MIN_MS = 50;
const DROWSINESS_THRESHOLD_MS = 1500;
const BLINK_REFRACTORY_MS = 80;
const REOPEN_STABILITY_MS = 90;

let sessionActive = false;
let sessionStartTime = null;
let blinkCount = 0;
let longClosureEvents = 0;
let blinkHistory = [];
let lastBlinkTime = 0;
let eyesClosed = false;
let eyeClosedStart = 0;
let cameraStream = null;
let videoElement = document.getElementById('webcam'); // Get from DOM
let faceLandmarker = null;
let updateInterval = null;
let rafId = null;

// EAR Calibration variables
let earThreshold = DEFAULT_EAR_THRESHOLD;
let earCalibrationSamples = [];
const CALIBRATION_SAMPLES_REQUIRED = 30;
let openStateStartAt = 0;

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
      console.log(`[DevWell Monitor] EAR Calibration complete. New threshold: ${earThreshold.toFixed(3)} (avg open EAR: ${avg.toFixed(3)})`);
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

async function startSession() {
  if (sessionActive) return;

  if (!faceLandmarker) {
    try {
      console.log('[DevWell Monitor] Initializing FaceLandmarker...');
      const filesetResolver = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('lib/wasm'));
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('lib/face_landmarker.task'),
          delegate: 'GPU' // Use GPU in a visible tab for better performance
        },
        runningMode: 'VIDEO',
        numFaces: 1
      });
      console.log('[DevWell Monitor] FaceLandmarker initialized.');
    } catch (err) {
      console.error('[DevWell Monitor] FaceLandmarker initialization error:', err);
      // Inform the user on the page
      document.body.innerHTML = `<h1>Error</h1><p>Could not load the AI model. Please reload the extension and try again.</p><p><i>${err.message}</i></p>`;
      return;
    }
  }

  console.log('[DevWell Monitor] Starting session...');
  sessionActive = true;
  sessionStartTime = Date.now();
  // Reset all session counters
  blinkCount = 0;
  longClosureEvents = 0;
  blinkHistory = [];
  lastBlinkTime = 0;
  eyesClosed = false;
  eyeClosedStart = 0;
  openStateStartAt = 0;
  earThreshold = DEFAULT_EAR_THRESHOLD;
  earCalibrationSamples = [];
  
  try {
    console.log('[DevWell Monitor] Requesting camera access...');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    videoElement.srcObject = cameraStream;
    videoElement.onloadedmetadata = () => {
      videoElement.play();
      console.log('[DevWell Monitor] Video playing, starting processFrame loop.');
      // Start the metrics interval and the processing loop
      updateInterval = setInterval(() => {
        if (!sessionActive) return;
        chrome.runtime.sendMessage({ action: 'monitorMetrics', data: buildSessionData() }).catch(() => undefined);
      }, 1000);
      chrome.runtime.sendMessage({ action: 'monitorStarted', data: buildSessionData() }).catch(() => undefined);
      processFrame();
    };
  } catch (err) {
    console.error('[DevWell Monitor] getUserMedia error:', err);
    document.body.innerHTML = `<h1>Camera Permission Denied</h1><p>Please allow camera access and try again.</p><p><i>${err.message}</i></p>`;
    chrome.runtime.sendMessage({ action: 'monitorError', error: 'Camera permission denied' }).catch(() => undefined);
  }
}

function onFaceLandmarkerResults(results) {
  if (!sessionActive || !results.faceLandmarks || results.faceLandmarks.length === 0) return;

  const landmarks = results.faceLandmarks[0];
  const leftEAR = computeEAR(landmarks, LEFT_EYE);
  const rightEAR = computeEAR(landmarks, RIGHT_EYE);
  const avgEAR = (leftEAR + rightEAR) / 2;

  if (earCalibrationSamples.length < CALIBRATION_SAMPLES_REQUIRED) {
    updateEARCalibration(avgEAR);
  }

  const now = Date.now();
  const eyesCurrentlyClosed = avgEAR < earThreshold;

  if (eyesCurrentlyClosed) {
    openStateStartAt = 0;
    if (!eyesClosed) {
      eyesClosed = true;
      eyeClosedStart = now;
    }
  } else if (!eyesCurrentlyClosed && eyesClosed) {
    if (openStateStartAt === 0) openStateStartAt = now;
    if (now - openStateStartAt >= REOPEN_STABILITY_MS) {
      const closedDuration = now - eyeClosedStart;
      if (closedDuration >= DROWSINESS_THRESHOLD_MS) {
        longClosureEvents += 1;
      } else if (closedDuration >= BLINK_MIN_MS) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          blinkCount += 1;
          blinkHistory.push(now);
          lastBlinkTime = now;
        }
      }
      eyesClosed = false;
    }
  }
}

let lastVideoTime = -1;
async function processFrame() {
  if (!sessionActive) return;

  const startTimeMs = performance.now();
  if (videoElement.readyState >= 2 && startTimeMs - lastVideoTime >= 33) { // Cap at ~30 FPS
      lastVideoTime = startTimeMs;
      const results = faceLandmarker.detectForVideo(videoElement, startTimeMs);
      onFaceLandmarkerResults(results);
  }

  rafId = requestAnimationFrame(processFrame);
}

function stopSession() {
  if (!sessionActive) return;
  console.log('[DevWell Monitor] Stopping session...');
  sessionActive = false;
  
  if (rafId) cancelAnimationFrame(rafId);
  if (updateInterval) clearInterval(updateInterval);

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  
  if (videoElement) {
    videoElement.srcObject = null;
  }
  
  chrome.runtime.sendMessage({ action: 'monitorStopped', data: buildSessionData() }).catch(() => undefined);
}

// Listen for messages from the background script to stop
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'stop') {
    stopSession();
    // Tab can be closed by the background script after this message
  }
});

// Automatically start the session when the page loads
startSession();
