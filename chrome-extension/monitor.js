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
const HIDDEN_LOOP_BACKOFF_MS = 40;
const VISIBLE_FRAME_INTERVAL_MS = 66; // ~15 FPS

let sessionActive = false;
let sessionStartTime = null;
let blinkCount = 0;
let longClosureEvents = 0;
let blinkHistory = [];
let lastBlinkTime = 0;
let eyesClosed = false;
let eyeClosedStart = 0;
let cameraStream = null;
let cameraTrack = null;
let videoElement = document.getElementById('webcam'); // Get from DOM
let faceLandmarker = null;
let updateInterval = null;
let rafId = null;
let backgroundTimeoutId = null;
let imageCapture = null;
let hiddenFrameReader = null;
let hiddenFrameLoopActive = false;
let isTabVisible = true;
const processingCanvas = document.createElement('canvas');
const processingCtx = processingCanvas.getContext('2d', { willReadFrequently: true });
processingCanvas.width = 640;
processingCanvas.height = 480;

// Listen for visibility changes
document.addEventListener('visibilitychange', () => {
  const wasVisible = isTabVisible;
  isTabVisible = document.visibilityState === 'visible';
  console.log(`[DevWell Monitor] Tab visibility changed: ${isTabVisible ? 'visible' : 'hidden'}`);

  if (!sessionActive) return;

  if (isTabVisible && !wasVisible) {
    clearFrameLoopHandles();
    processFrame();
    return;
  }

  if (!isTabVisible) {
    ensureHiddenCaptureProviders();
  }

  if (!isTabVisible) {
    clearFrameLoopHandles();
    scheduleNextFrame();
  }
});

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
}

function clearFrameLoopHandles() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (backgroundTimeoutId) {
    clearTimeout(backgroundTimeoutId);
    backgroundTimeoutId = null;
  }
}

function createHiddenTrackReader(track) {
  if (!track || typeof MediaStreamTrackProcessor === 'undefined') return null;
  try {
    const processor = new MediaStreamTrackProcessor({ track });
    return processor.readable.getReader();
  } catch (err) {
    console.warn('[DevWell Monitor] MediaStreamTrackProcessor unavailable for this track.', err);
    return null;
  }
}

function closeHiddenTrackReader() {
  const reader = hiddenFrameReader;
  hiddenFrameReader = null;
  if (!reader) return;
  reader.cancel?.().catch(() => undefined);
  reader.releaseLock?.();
}

function ensureHiddenCaptureProviders() {
  if (!cameraTrack) return;
  if (!hiddenFrameReader) {
    hiddenFrameReader = createHiddenTrackReader(cameraTrack);
  }
  if (!imageCapture && typeof ImageCapture !== 'undefined') {
    try {
      imageCapture = new ImageCapture(cameraTrack);
    } catch (err) {
      console.warn('[DevWell Monitor] ImageCapture unavailable for this track.', err);
      imageCapture = null;
    }
  }
}

function scheduleNextFrame() {
  if (!sessionActive) return;

  clearFrameLoopHandles();

  if (!isTabVisible) {
    ensureHiddenCaptureProviders();
    if (!hiddenFrameLoopActive) {
      void runHiddenFrameLoop();
    }
    return;
  }

  if (isTabVisible) {
    rafId = requestAnimationFrame(processFrame);
    return;
  }
}

async function runHiddenFrameLoop() {
  if (hiddenFrameLoopActive || !sessionActive || isTabVisible) return;
  hiddenFrameLoopActive = true;

  try {
    while (sessionActive && !isTabVisible) {
      ensureHiddenCaptureProviders();
      let detected = false;

      if (hiddenFrameReader) {
        try {
          const frame = await Promise.race([
            hiddenFrameReader.read(),
            new Promise((resolve) => setTimeout(() => resolve({ done: true }), HIDDEN_READER_TIMEOUT_MS)),
          ]);
          if (frame.done || !frame.value) {
            closeHiddenTrackReader();
          } else {
            const videoFrame = frame.value;
            try {
              processingCtx.drawImage(videoFrame, 0, 0, processingCanvas.width, processingCanvas.height);
              const now = performance.now();
              const results = faceLandmarker.detectForVideo(processingCanvas, now);
              onFaceLandmarkerResults(results);
              detected = true;
            } finally {
              videoFrame.close?.();
            }
          }
        } catch (err) {
          console.warn('[DevWell Monitor] Hidden track reader failed, switching source.', err);
          closeHiddenTrackReader();
        }
      }

      if (!detected && imageCapture) {
        try {
          const bitmap = await Promise.race([
            imageCapture.grabFrame(),
            new Promise((resolve) => setTimeout(() => resolve(null), HIDDEN_GRAB_TIMEOUT_MS)),
          ]);
          if (!bitmap) {
            imageCapture = null;
            continue;
          }
          try {
            processingCtx.drawImage(bitmap, 0, 0, processingCanvas.width, processingCanvas.height);
            const now = performance.now();
            const results = faceLandmarker.detectForVideo(processingCanvas, now);
            onFaceLandmarkerResults(results);
            detected = true;
          } finally {
            bitmap.close();
          }
        } catch (err) {
          console.warn('[DevWell Monitor] Hidden ImageCapture failed, switching source.', err);
          imageCapture = null;
        }
      }

      if (!detected && videoElement.readyState >= 2) {
        processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
        const now = performance.now();
        const results = faceLandmarker.detectForVideo(processingCanvas, now);
        onFaceLandmarkerResults(results);
        detected = true;
      }

      if (!detected) {
        await new Promise(resolve => setTimeout(resolve, HIDDEN_LOOP_BACKOFF_MS));
      }
    }
  } finally {
    hiddenFrameLoopActive = false;
    if (sessionActive && isTabVisible) {
      scheduleNextFrame();
    }
  }
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
          // CPU delegate is more stable in hidden/minimized tab scenarios.
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true
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
  resetSessionCounters();
  
  try {
    console.log('[DevWell Monitor] Requesting camera access...');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    videoElement.srcObject = cameraStream;

    cameraTrack = cameraStream.getVideoTracks()[0] || null;
    imageCapture = null;
    closeHiddenTrackReader();
    ensureHiddenCaptureProviders();
    if (hiddenFrameReader) {
      console.log('[DevWell Monitor] MediaStreamTrackProcessor enabled for hidden-tab frame processing.');
    } else if (imageCapture) {
      console.log('[DevWell Monitor] ImageCapture enabled for hidden-tab frame processing.');
    }

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

  // Log EAR values to help debug
  if (blinkCount % 10 === 0 || !eyesClosed !== !eyesCurrentlyClosed) {
    console.log(`[DevWell Monitor] EAR: ${avgEAR.toFixed(3)}, Threshold: ${earThreshold.toFixed(3)}, Closed: ${eyesCurrentlyClosed}`);
  }

  if (eyesCurrentlyClosed) {
    openStateStartAt = 0;
    if (!eyesClosed) {
      eyesClosed = true;
      eyeClosedStart = now;
    }
  } else if (!eyesCurrentlyClosed && eyesClosed) {
    if (openStateStartAt === 0) openStateStartAt = now;
    
    // Calculate if we've been open long enough to be stable.
    // In background (low FPS), we might only get one frame of 'open' after closure.
    // If the gap since the last frame is large (> 150ms), we skip the stability check.
    const isBackground = !isTabVisible;
    const stableEnough = (now - openStateStartAt >= REOPEN_STABILITY_MS) || isBackground;
    
    if (stableEnough) {
      const closedDuration = now - eyeClosedStart;
      console.log(`[DevWell Monitor] Classifying closure: ${closedDuration}ms (threshold: ${BLINK_MIN_MS}-${DROWSINESS_THRESHOLD_MS}ms)`);
      
      if (closedDuration >= DROWSINESS_THRESHOLD_MS) {
        longClosureEvents += 1;
        console.log(`[DevWell Monitor] Drowsy event detected: ${closedDuration}ms`);
      } else if (closedDuration >= BLINK_MIN_MS) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          blinkCount += 1;
          blinkHistory.push(now);
          lastBlinkTime = now;
          console.log(`[DevWell Monitor] ✓ Blink detected! Count: ${blinkCount}, Duration: ${closedDuration}ms`);
        } else {
          console.log(`[DevWell Monitor] ✗ Blink skipped (refractory)`);
        }
      }
      eyesClosed = false;
    }
  }
}

let lastVideoTime = -1;
async function processFrame() {
  if (!sessionActive) return;

  if (!isTabVisible) {
    scheduleNextFrame();
    return;
  }

  const now = performance.now();
  
  // Ensure we have a video element and it's ready
  if (videoElement.readyState >= 2) {
    // When visible, we target ~15fps (66ms).
    const minDelay = VISIBLE_FRAME_INTERVAL_MS;
    
    if (now - lastVideoTime >= minDelay) {
      lastVideoTime = now;
      
      // Draw to canvas first. This ensures we have a fresh frame even if the video element
      // is being throttled by the browser's compositor.
      processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
      
      try {
        const results = faceLandmarker.detectForVideo(processingCanvas, now);
        onFaceLandmarkerResults(results);
      } catch (err) {
        console.error('[DevWell Monitor] Detection error:', err);
      }
    }
  }

  scheduleNextFrame();
}

function stopSession() {
  if (!sessionActive) return;
  console.log('[DevWell Monitor] Stopping session...');
  sessionActive = false;

  clearFrameLoopHandles();
  closeHiddenTrackReader();
  imageCapture = null;
  cameraTrack = null;
  hiddenFrameLoopActive = false;
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
