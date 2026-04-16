# Summary of Latest Fixes (Tasks Vision API Migration & Session Saving)

This document outlines the changes made to resolve the fatal `unsafe-eval` errors, stabilize the blink detection loop, and ensure session data correctly persists to the backend database.

## 1. Migrated to MediaPipe Tasks Vision API
**Problem:** The previous `@mediapipe/face_mesh` library relied on `new Function()`, which is permanently blocked by Chrome's Manifest V3 security policies.
**Solution:**
* Migrated to the modern `@mediapipe/tasks-vision` API.
* Implemented as an ES Module (`vision_bundle.js`).
* Uses `FaceLandmarker.createFromOptions()` with CPU/GPU delegation.

## 2. Switched to Dedicated Tab Architecture
**Problem:** Background scripts (Service Workers) and Offscreen Documents are aggressively throttled or killed after 30 seconds by Chrome, making them unreliable for continuous monitoring.
**Solution:**
* **`monitor.html`:** Replaced the hidden offscreen document with a visible, pinned tab.
* **100% Stability:** Visible tabs are never killed by the 30-second timer.
* **Camera Access:** Handles camera permission prompts naturally and provides a live preview.

## 3. Reliable Session Timer
**Problem:** The UI timer would freeze if the monitoring process was throttled.
**Solution:**
* Moved the "source of truth" for session duration into `background.js`. 
* The background script now runs a reliable `setInterval` to broadcast the exact elapsed time to the popup and badge every second.

## 4. Implemented Database Saving
**Problem:** Completed sessions were not being saved to the backend database.
**Solution:**
* Added a `fetch()` POST request in `background.js` inside the `monitorStopped` handler.
* Automatically saves metrics (duration, blink rate, fatigue score) to `http://localhost:3001/api/v1/sessions` when the session ends.

## 5. Performance & Error Handling
* **30 FPS Cap:** Capped the AI processing loop to 30 FPS to prevent high CPU usage.
* **Robust Cleanup:** Ensures camera tracks, intervals, and tabs are properly closed when a session ends or an error occurs.
* **User Feedback:** Technical errors are now translated into helpful, visible messages in the UI.
