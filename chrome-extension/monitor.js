import { FaceLandmarker, FilesetResolver } from './lib/vision_bundle.js';

const BLINK_MIN_MS = 35;
const DROWSINESS_THRESHOLD_MS = 1500;
const BLINK_REFRACTORY_MS = 80;
const REOPEN_STABILITY_MS = 90;
const HIDDEN_READER_TIMEOUT_MS = 280;
const HIDDEN_GRAB_TIMEOUT_MS = 280;
const HIDDEN_LOOP_INTERVAL_MS = 150; 
const HIDDEN_LOOP_WATCHDOG_MS = 800;
const VISIBLE_FRAME_INTERVAL_MS = 100;
const UNKNOWN_FRAME_RESET_MS = 2500;
const BACKGROUND_SPARSE_GAP_MS = 700;
const PERCLOS_WINDOW_MS = 60000;
const BACKGROUND_MIN_CLOSED_SAMPLES = 3;
const DROWSY_EVENT_COOLDOWN_MS = 10000;
const LONG_CLOSURE_WINDOW_MS = 60000;
const MAX_VISIBLE_FRAME_GAP_MS = 450;
const MAX_HIDDEN_FRAME_GAP_MS = 900;
const MAX_METRIC_PITCH_DEG = 22;
const MIN_METRIC_PITCH_DEG = -15;
const LOOKING_DOWN_PITCH_DEG = 18;
const MAX_EYE_ASYMMETRY = 0.65;
const MIN_FACE_BBOX_AREA = 0.035;
const HIDDEN_QUALITY_RESUME_STABLE_MS = 1800;

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
let hiddenLoopWatchdogId = null;
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
let lastDrowsyEventAt = 0;
let cameraStatus = 'inactive';
let lastFaceDetectedAt = 0;
const processingCanvas = document.createElement('canvas');
const processingCtx = processingCanvas.getContext('2d', { willReadFrequently: true });
processingCanvas.width = 640;
processingCanvas.height = 480;

const AUTO_PAUSE_THRESHOLD_MS = 20000;
const AUTO_PAUSE_THRESHOLD_HIDDEN_MS = 90000;

let lowBlinkRate = 15;
let openStateStartAt = 0;
let perclosValue = 0;
let eyeClosureHistory = [];
let currentState = 'FACE_LOST';
let smoothedFatigueScore = 0;
let lastFatigueSmoothAt = 0;
let pendingState = 'FACE_LOST';
let stateHoldStart = 0;
let blinkIntervals = [];
let recentClosures = [];
let recentLongClosures = [];
let trackingQuality = 'good';
let lowQualityStartAt = 0;
let lastClosedSampleAt = 0;
let freezeHiddenMetrics = false;
let hiddenStableStartAt = 0;
let shutdownIntervalId = null;
let monitorClosing = false;

function logMonitorError(scope, error) {
  try {
    console.warn(`[DevWell Monitor] ${scope}:`, error?.message || error);
  } catch (_) {}
}

function calculateStdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function getBlendshapeScore(blendshapes, name) {
  return blendshapes.find(b => b.categoryName === name)?.score ?? 0;
}

function areEyesClosed(left, right) {
  if (left > 0.35 && right > 0.35) return true;
  if (left > 0.55 && right > 0.2) return true;
  if (right > 0.55 && left > 0.2) return true;
  return false;
}

function calculateHeadPitch(landmarks) {
  const chin = landmarks[152];
  const forehead = landmarks[10];
  const faceVectorY = chin.y - forehead.y;
  const faceVectorZ = (chin.z || 0) - (forehead.z || 0);
  const pitchRad = Math.atan2(faceVectorZ, faceVectorY);
  return pitchRad * (180 / Math.PI);
}

function getFaceBoundingBoxArea(landmarks) {
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

function evaluateFrameQuality({ frameGap, isBackground, pitch, eyeBlinkLeft, eyeBlinkRight, landmarks }) {
  if (!Number.isFinite(eyeBlinkLeft) || !Number.isFinite(eyeBlinkRight)) {
    return { ok: false, reason: 'invalid_eyes' };
  }

  if (eyeBlinkLeft < 0 || eyeBlinkLeft > 1 || eyeBlinkRight < 0 || eyeBlinkRight > 1) {
    return { ok: false, reason: 'eye_range' };
  }

  const maxFrameGap = isBackground ? MAX_HIDDEN_FRAME_GAP_MS : MAX_VISIBLE_FRAME_GAP_MS;
  if (frameGap > 0 && frameGap > maxFrameGap) {
    return { ok: false, reason: 'sparse_frames' };
  }

  if (!Number.isFinite(pitch) || pitch > MAX_METRIC_PITCH_DEG || pitch < MIN_METRIC_PITCH_DEG) {
    return { ok: false, reason: 'pose' };
  }

  if (Math.abs(eyeBlinkLeft - eyeBlinkRight) > MAX_EYE_ASYMMETRY) {
    return { ok: false, reason: 'eye_asymmetry' };
  }

  const faceArea = getFaceBoundingBoxArea(landmarks);
  if (!Number.isFinite(faceArea) || faceArea < MIN_FACE_BBOX_AREA) {
    return { ok: false, reason: 'small_face' };
  }

  return { ok: true, reason: 'good' };
}

document.addEventListener('visibilitychange', () => {
  const wasVisible = isTabVisible;
  isTabVisible = document.visibilityState === 'visible';
  if (!sessionActive) return;

  if (isTabVisible && !wasVisible) {
    clearFrameLoopHandles();
    scheduleNextFrame();
  } else if (!isTabVisible) {
    ensureHiddenCaptureProviders();
    clearFrameLoopHandles();
    scheduleNextFrame();
  }
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => { try { t.stop(); t.enabled = false; } catch (e) { logMonitorError('stop track', e); } });
    cameraStream = null;
  }
  if (cameraTrack) { try { cameraTrack.stop(); } catch(e) { logMonitorError('stop cameraTrack', e); } cameraTrack = null; }
  closeHiddenTrackReader();
  imageCapture = null;
  if (videoElement) {
    try { videoElement.pause(); videoElement.srcObject = null; videoElement.load(); } catch (e) { logMonitorError('reset video element', e); }
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

function calculateFatigueScore(sessionMinutes, currentBlinkRate, now) {
  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  const scoreInputsReliable =
    currentState === 'ATTENTIVE' &&
    trackingQuality === 'good' &&
    !freezeHiddenMetrics;

  const normalizedPerclos = perclosValue / 25;
  const perclosWeight = sigmoid((normalizedPerclos - 0.5) * 6) * 25;

  const referenceRate = Math.max(1, lowBlinkRate);
  const relativeDeficit = Math.max(0, (referenceRate - currentBlinkRate) / referenceRate);
  const blinkDeficit = relativeDeficit * 30;

  const stdDev = calculateStdDev(blinkIntervals);
  const variabilityPenalty = Math.min(stdDev / 2000, 1) * 15;

  recentLongClosures = recentLongClosures.filter((t) => now - t <= LONG_CLOSURE_WINDOW_MS);
  const acuteClosureWeight = Math.min(recentLongClosures.length * 5, 15);
  
  const durationFactor = 1 - Math.exp(-sessionMinutes / 60);
  const durationPenalty = durationFactor * 20;

  const burstPenalty = Math.min(recentClosures.length * 3, 10);

  let rawFatigueScore = Math.min(100, Math.max(0, perclosWeight + blinkDeficit + variabilityPenalty + acuteClosureWeight + durationPenalty + burstPenalty));

  const adaptationRate = 0.05;
  if (now - lastFatigueSmoothAt >= 1000) {
    if (!scoreInputsReliable) {
      // Hold score during unreliable tracking so hidden/popup interaction does not create artificial growth.
      smoothedFatigueScore *= 0.995;
      lastFatigueSmoothAt = now;
      return Math.round(smoothedFatigueScore);
    }

    smoothedFatigueScore += (rawFatigueScore - smoothedFatigueScore) * adaptationRate;
    
    if (perclosValue < 5 && currentBlinkRate >= referenceRate && longClosureEvents === 0) {
      smoothedFatigueScore *= 0.97;
    }
    
    lastFatigueSmoothAt = now;
  }
  return Math.round(smoothedFatigueScore);
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
  
  const fatigueScore = calculateFatigueScore(durationMinutes, currentBlinkRate, now);

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
    trackingQuality,
    eyesOpen: !eyesClosed,
    perclos: Math.round(perclosValue * 10) / 10,
  };
}

function updatePERCLOS(now) {
  if (eyesClosed && lastClosedSampleAt > 0 && (now - lastClosedSampleAt > 600)) {
    resetClosureTracking();
  }

  const windowStart = now - PERCLOS_WINDOW_MS;
  eyeClosureHistory = eyeClosureHistory.filter(event => event.end > windowStart);
  
  let totalClosedMs = 0;
  eyeClosureHistory.forEach(event => {
    const effectiveStart = Math.max(event.start, windowStart);
    totalClosedMs += (event.end - effectiveStart);
  });
  
  if (eyesClosed) {
    const effectiveStart = Math.max(eyeClosedStart, windowStart);
    const effectiveEnd = openStateStartAt > 0 ? openStateStartAt : now;
    if (effectiveEnd > effectiveStart) {
      totalClosedMs += (effectiveEnd - effectiveStart);
    }
  }
  
  perclosValue = (totalClosedMs / PERCLOS_WINDOW_MS) * 100;
}

// Moved to the bottom of the file

function clearFrameLoopHandles() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (hiddenLoopWatchdogId) { clearTimeout(hiddenLoopWatchdogId); hiddenLoopWatchdogId = null; }
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
  } catch (e) { logMonitorError('closeHiddenTrackReader', e); }
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
  ensureHiddenCaptureProviders();
  if (!hiddenFrameLoopActive) void runHiddenFrameLoop();
  hiddenLoopWatchdogId = setTimeout(() => {
    if (sessionActive && !hiddenFrameLoopActive) {
      void runHiddenFrameLoop();
    }
  }, HIDDEN_LOOP_WATCHDOG_MS);
}

async function runHiddenFrameLoop() {
  if (hiddenFrameLoopActive || !sessionActive) return;
  hiddenFrameLoopActive = true;

  try {
    while (sessionActive) {
      const loopStart = performance.now();
      ensureHiddenCaptureProviders();
      let detected = false;

      if (hiddenFrameReader) {
        try {
          const readPromise = hiddenFrameReader.read();
          const frame = await Promise.race([
            readPromise,
            new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), HIDDEN_READER_TIMEOUT_MS)),
          ]);

          if (frame.timeout) {
            // Handle late arrival to prevent VideoFrame leaks
            readPromise.then(f => { if (f?.value) f.value.close?.(); }).catch(() => {});
            closeHiddenTrackReader();
          } else if (!frame.done && frame.value) {
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
          const grabPromise = imageCapture.grabFrame();
          const bitmap = await Promise.race([
            grabPromise,
            new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), HIDDEN_GRAB_TIMEOUT_MS)),
          ]);
          if (bitmap && !bitmap.timeout) {
            try {
              processingCtx.drawImage(bitmap, 0, 0, processingCanvas.width, processingCanvas.height);
              onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
              detected = true;
            } finally { bitmap.close(); }
          } else if (bitmap?.timeout) {
            // Handle late arrival to prevent ImageBitmap leaks
            grabPromise.then(b => b?.close?.()).catch(() => {});
            imageCapture = null;
          } else { imageCapture = null; }
        } catch (err) { imageCapture = null; }
      }

      if (!detected && videoElement.readyState >= 2) {
        processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
        onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
        detected = true;
      }

      if (!detected) {
        try {
          processingCtx.drawImage(videoElement, 0, 0, processingCanvas.width, processingCanvas.height);
          onFaceLandmarkerResults(faceLandmarker.detectForVideo(processingCanvas, performance.now()));
          detected = true;
        } catch (e) { logMonitorError('hidden fallback draw', e); }
      }

      if (!detected) {
        const processingTime = performance.now() - loopStart;
        const delay = Math.max(10, HIDDEN_LOOP_INTERVAL_MS - processingTime);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        if (!hiddenFrameReader) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
  } finally {
    hiddenFrameLoopActive = false;
    if (sessionActive) scheduleNextFrame();
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
    scheduleNextFrame();
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
  lastResultAt = 0;
  blinkIntervals = [];
  recentClosures = [];
  recentLongClosures = [];
  lastDrowsyEventAt = 0;
  trackingQuality = 'good';
  lowQualityStartAt = 0;
  lastClosedSampleAt = 0;
  freezeHiddenMetrics = false;
  hiddenStableStartAt = 0;
  resetClosureTracking();
}

function resetClosureTracking() {
  eyesClosed = false;
  eyeClosedStart = 0;
  closureSampleCount = 0;
  drowsinessCounted = false;
  lastClosedSampleAt = 0;
  openStateStartAt = 0;
  unknownStateStartAt = 0;
}

function handleUnknownTrackingFrame(now) {
  const noFaceDuration = now - lastFaceDetectedAt;
  const autoPauseThreshold = isTabVisible ? AUTO_PAUSE_THRESHOLD_MS : AUTO_PAUSE_THRESHOLD_HIDDEN_MS;
  if (noFaceDuration >= autoPauseThreshold && !isPaused) {
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
  const frameGap = lastResultAt > 0 ? now - lastResultAt : 0;
  lastResultAt = now;
  const isBackground = !isTabVisible;
  
  const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
  const eyeBlinkLeft = getBlendshapeScore(blendshapes, 'eyeBlinkLeft');
  const eyeBlinkRight = getBlendshapeScore(blendshapes, 'eyeBlinkRight');
  const pitch = calculateHeadPitch(landmarks);

  // Immediate guard: downward gaze can look like partial eye-closure and inflate PERCLOS.
  if (pitch > LOOKING_DOWN_PITCH_DEG) {
    trackingQuality = 'limited';
    resetClosureTracking();
    return;
  }

  if (pitch > 30 || pitch < -20 || !Number.isFinite(pitch)) {
    trackingQuality = 'poor';
    return;
  }

  let nextState = 'ATTENTIVE';
  if (!faceDetected) {
    nextState = 'FACE_LOST';
  } else if (pitch > LOOKING_DOWN_PITCH_DEG) {
    nextState = 'LOOKING_DOWN';
  }

  if (nextState !== currentState) {
    if (pendingState !== nextState) {
      pendingState = nextState;
      stateHoldStart = now;
    }
    if (now - stateHoldStart > 800) {
      currentState = nextState;
    }
  } else {
    pendingState = nextState;
  }

  if (currentState !== 'ATTENTIVE') {
    trackingQuality = 'limited';
    resetClosureTracking();
    handleUnknownTrackingFrame(now);
    return;
  }

  unknownStateStartAt = 0;
  const frameQuality = evaluateFrameQuality({
    frameGap,
    isBackground,
    pitch,
    eyeBlinkLeft,
    eyeBlinkRight,
    landmarks,
  });

  if (!frameQuality.ok) {
    trackingQuality = 'poor';
    if (isBackground) {
      freezeHiddenMetrics = true;
      hiddenStableStartAt = 0;
      resetClosureTracking();
      return;
    }
    // Avoid dropping valid foreground closures on single noisy frames.
    if (lowQualityStartAt === 0) lowQualityStartAt = now;
    if (now - lowQualityStartAt >= 1200) {
      resetClosureTracking();
    }
    return;
  }

  if (isBackground && freezeHiddenMetrics) {
    if (hiddenStableStartAt === 0) hiddenStableStartAt = now;
    if (now - hiddenStableStartAt < HIDDEN_QUALITY_RESUME_STABLE_MS) {
      trackingQuality = 'limited';
      return;
    }
    freezeHiddenMetrics = false;
    hiddenStableStartAt = 0;
  }

  if (!isBackground) {
    freezeHiddenMetrics = false;
    hiddenStableStartAt = 0;
  }

  trackingQuality = 'good';
  lowQualityStartAt = 0;

  const eyesCurrentlyClosed = areEyesClosed(eyeBlinkLeft, eyeBlinkRight);

  if (eyesCurrentlyClosed) {
    lastClosedSampleAt = now;
    openStateStartAt = 0;
    if (!eyesClosed) {
      eyesClosed = true;
      eyeClosedStart = now;
      closureSampleCount = 1;
    } else {
      closureSampleCount += 1;
    }
  } else if (!eyesCurrentlyClosed && eyesClosed) {
    lastClosedSampleAt = 0;
    if (openStateStartAt === 0) openStateStartAt = now;
    const stableEnough = (now - openStateStartAt >= REOPEN_STABILITY_MS) || isBackground;
    
    if (stableEnough) {
      const closedDuration = openStateStartAt - eyeClosedStart;

      if (closedDuration >= 200 && closureSampleCount >= (isBackground ? BACKGROUND_MIN_CLOSED_SAMPLES : 3)) {
        eyeClosureHistory.push({ start: eyeClosedStart, end: openStateStartAt });
        recentClosures.push(now);
        recentClosures = recentClosures.filter(t => now - t < 10000);
      }

      if (closedDuration >= DROWSINESS_THRESHOLD_MS) {
        const drowsySampleRequirementMet = !isBackground || closureSampleCount >= BACKGROUND_MIN_CLOSED_SAMPLES;
        const drowsyCooldownElapsed = now - lastDrowsyEventAt >= DROWSY_EVENT_COOLDOWN_MS;
        if (!drowsinessCounted && drowsySampleRequirementMet && drowsyCooldownElapsed) {
          longClosureEvents += 1;
          recentLongClosures.push(now);
          drowsinessCounted = true;
          lastDrowsyEventAt = now;
        }
      } else if (closedDuration >= BLINK_MIN_MS && closedDuration < DROWSINESS_THRESHOLD_MS) {
        if (now - lastBlinkTime >= BLINK_REFRACTORY_MS) {
          if (!isBackground || closureSampleCount >= BACKGROUND_MIN_CLOSED_SAMPLES) {
            if (lastBlinkTime > 0) {
              const interval = now - lastBlinkTime;
              blinkIntervals.push(interval);
              if (blinkIntervals.length > 20) blinkIntervals.shift();
            }
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
    try { faceLandmarker.close(); } catch (e) { logMonitorError('faceLandmarker close', e); }
    faceLandmarker = null;
  }

  try { chrome.runtime.sendMessage({ action: 'monitorStopped', data: buildSessionData() }).catch(() => undefined); } catch (e) { logMonitorError('send monitorStopped', e); }
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
    if (!monitorClosing) {
      monitorClosing = true;
      setTimeout(() => window.close(), 100);
    }
  });
} catch (e) { logMonitorError('runtime connect', e); }

shutdownIntervalId = setInterval(() => {
  try {
    if (!chrome.runtime?.id || !chrome.runtime.getManifest()) {
      stopSession();
      if (!monitorClosing) {
        monitorClosing = true;
        clearInterval(shutdownIntervalId);
        window.close();
      }
    }
  } catch (e) {
    stopSession();
    logMonitorError('shutdown healthcheck', e);
    if (!monitorClosing) {
      monitorClosing = true;
      clearInterval(shutdownIntervalId);
      window.close();
    }
  }
}, 1000);

window.addEventListener('beforeunload', stopSession);
