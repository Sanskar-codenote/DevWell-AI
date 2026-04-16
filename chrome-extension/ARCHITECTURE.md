# DevWell Chrome Extension Architecture

## Overview
Real-time developer wellness monitoring with fatigue detection, session tracking, and analytics using the modern MediaPipe Tasks Vision library for blink detection. This architecture uses a dedicated, visible tab for camera processing to ensure 100% stability and bypass the limitations of background scripts in Manifest V3.

## Core Architecture: Dedicated Tab Model

```
┌─────────────────────────────────────────────────────────┐
│  background.js (Service Worker)                         │
│  - Manages session lifecycle                            │
│  - Creates/closes the 'monitor.html' tab                │
│  - Routes metrics from monitor tab to UI components     │
│  - Handles alerts, notifications, badge updates         │
│  - Saves final session data to the backend API          │
└─────────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────────┐
│  monitor.html + monitor.js (Dedicated Visible Tab)      │
│  - Requests and owns the camera stream (getUserMedia)   │
│  - Runs the FaceLandmarker model for blink detection    │
│  - Performs EAR calibration for personalized threshold  │
│  - Sends metrics to background.js every second          │
│  - Displays the camera feed to the user                 │
└─────────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────────┐
│  popup.html + popup.js (Popup UI)                       │
│  - Handles user login/logout                            │
│  - "Start Session" button tells background to open tab  │
│  - "End Session" button tells background to close tab   │
│  - Displays real-time metrics received from storage     │
└─────────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────────┐
│  content.js (Injected into DevWell Website)             │
│  - Provides a seamless start/stop experience from web   │
│  - Communicates user actions to the background script   │
└─────────────────────────────────────────────────────────┘
```

## File Purposes

### Core Files
- **background.js** - The central controller. Manages the monitor tab, handles all session state, and communicates with the backend.
- **monitor.html** - A visible HTML page that contains the `<video>` element. This is the "engine" of the extension.
- **monitor.js** - The script for the monitor tab. Handles camera access, runs the MediaPipe FaceLandmarker, calculates EAR, and detects blinks.
- **popup.html/popup.js** - The UI the user sees when clicking the extension icon.
- **content.js/content.css** - Injected into the DevWell website to sync session state and provide a floating widget.
- **manifest.json** - Standard extension configuration file.

### MediaPipe Integration (Tasks Vision)
- **lib/vision_bundle.js** - The core ES Module for the MediaPipe Tasks Vision library.
- **lib/face_landmarker.task** - The pre-trained AI model for detecting facial landmarks.
- **lib/wasm/** - The WebAssembly backend required by the vision library.

### Key Documentation
- **README.md** - General information about the extension.
- **ARCHITECTURE.md** - This file.
- **ALL_FIXES_SUMMARY.md** - A summary of major bug fixes and architectural changes.

## Session Flow

1. User opens the popup and logs in.
2. User clicks "Start Session" in the popup or on the DevWell website.
3. The UI sends a `requestStartSession` message to `background.js`.
4. `background.js` opens `monitor.html` in a new, pinned tab.
5. `monitor.js` automatically requests camera permission. Since the tab is visible, the user can see and approve the prompt directly.
6. Once permission is granted, `monitor.js` initializes the FaceLandmarker model.
7. The blink detection loop runs continuously, sending `monitorMetrics` messages to `background.js` every second.
8. `background.js` receives the metrics, updates `chrome.storage.local`, and updates the browser badge. The popup UI listens for these storage changes and updates itself in real-time.
9. When the user clicks "End Session", `background.js` sends a `stop` message to the monitor tab and then closes it.
10. `background.js` saves the final session data to the backend database.

## State Management

### chrome.storage.local Keys
- **sessionActive** (boolean) - Is a session currently running?
- **sessionData** (object) - The latest metrics from the monitor tab.
- **extensionAuth** (object) - User's authentication token and email.
- **sessionError** (string|null) - Stores any error messages.
- **monitorTabId** (number|null) - The ID of the active monitor tab.

### Key Message Actions
- **requestStartSession** - Sent from UI to background to start a new session.
- **requestStopSession** - Sent from UI to background to end the session.
- **monitorStarted** - Sent from monitor to background when the camera is successfully running.
- **monitorMetrics** - Sent from monitor to background every second with updated data.
- **monitorStopped** - Sent from monitor to background when the session has ended, just before the tab closes.
- **monitorError** - Sent from monitor to background if an error (like camera permission denied) occurs.
- **stop** - Sent from background to monitor to command it to shut down its camera stream.
