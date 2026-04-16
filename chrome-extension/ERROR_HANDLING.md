# Error Handling Implementation

## ✅ Modern Error Handling for Dedicated Tab Architecture

The DevWell extension uses a robust error-handling strategy tailored for Manifest V3 and the dedicated monitor tab model.

## 🛡️ Error Handling Strategy

### 1. **Cross-Context Communication**
Since the AI engine runs in a separate tab (`monitor.html`), errors are caught locally and then beamed to the background script via `chrome.runtime.sendMessage({ action: 'monitorError', ... })`. The background script then broadcasts this to the popup and cleans up the session.

### 2. **Library Resilience**
We migrated from the old FaceMesh library to **MediaPipe Tasks Vision**. This library is strictly Manifest V3 compatible and does not use `eval()`, preventing common CSP errors before they happen.

### 3. **User-Friendly Feedback**
Technical exceptions are translated into actionable advice:
- ❌ `NotAllowedError` → ✅ "Camera permission denied. Please allow access in the Monitor tab."
- ❌ `NotFoundError` → ✅ "No camera found. Please connect your webcam."
- ❌ `TypeError: vision is not defined` → ✅ "AI model failed to load. Please check your internet connection."

## 📋 Error Handling by Feature

### Camera & AI (Monitor Tab)
The `monitor.js` script handles the most critical errors:
- **Initialization:** If the `FaceLandmarker` fails to load (missing files or no GPU), it falls back to a descriptive error message on the page.
- **Permission:** If `getUserMedia` fails, the monitor tab displays a large instruction banner instead of just staying blank.
- **Throttling:** Uses `requestAnimationFrame` for performance and `performance.now()` for timing, preventing internal MediaPipe crashes from duplicate timestamps.

### Authentication & Backend
- **Network Resilience:** If the backend is down during session end, a warning is logged to the console, but the user's local session is still ended properly so the UI doesn't hang.
- **Token Safety:** If a token is missing or expired, the extension skips the database save step to prevent 401 errors, while still showing the user their session summary locally.

## 🎨 Visual Error System

### Popup Banners
Errors in the popup are shown as red banners that:
- Appear at the top of the container.
- Auto-dismiss after 5 seconds.
- Provide a manual "×" to close immediately.

### Monitor Tab Feedback
If the monitor tab encounters a fatal error (like camera blocking), it replaces its entire UI with a help screen, ensuring the user isn't left wondering why detection isn't working.

## 🔒 Safety Mechanisms

### 1. **Lifecycle Protection**
`background.js` acts as a watchdog. If you manually close the Monitor tab, the background script detects the `onRemoved` event and automatically triggers the "Stop Session" logic, ensuring your data is saved and the extension doesn't get stuck in a "Monitoring" state.

### 2. **Double-Click Prevention**
UI buttons are disabled immediately upon clicking (`isProcessing` flag) to prevent multiple monitor tabs from opening simultaneously.

### 3. **Resource Cleanup**
When a session ends or errors out, the extension ensures:
- Camera tracks are explicitly stopped.
- The `video.srcObject` is nullified.
- Intervals and animation loops are cleared.
- The monitor tab is closed.

---

**Reliability first. We handle the errors so you can focus on coding. 👁️💙**
