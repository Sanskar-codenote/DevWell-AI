# Guest Mode Technical Documentation

Guest Mode provides a privacy-focused, local-only experience for DevWell AI users who prefer not to create an account. This document outlines the technical implementation, data flow, and architecture of the Guest Mode feature within the Chrome Extension.

## 1. Architecture Overview

Guest Mode bypasses the standard JWT-based authentication flow, allowing the extension to operate independently of the backend API for session tracking and analytics.

### Key Components:
- **`popup.js`**: Manages the UI transition between Login and Guest states, persisting the choice in local storage.
- **`background.js`**: Acts as the orchestrator for monitoring sessions, handling session finalization, and saving data locally when in Guest Mode.
- **`chrome.storage.local`**: The primary database for Guest Mode, storing the active state, settings, and session history.

## 2. State Management

The Guest Mode state is persisted using the `guestModeActive` key in `chrome.storage.local`.

- **Entering Guest Mode**: Triggered by the "Continue as Guest" button in the login screen. Sets `guestModeActive: true`.
- **Exiting Guest Mode**: Triggered by the "Exit Guest" button (shared with Logout). Sets `guestModeActive: false` and stops any active monitoring.
- **Auto-Cleanup**: If a user logs in successfully, `guestModeActive` is automatically set to `false` to prevent state conflicts.

## 3. Session Lifecycle (Guest)

1.  **Start Request**: When the user clicks "Start Session", `background.js` checks if either a token exists OR `guestModeActive` is true.
2.  **Monitoring**: The `monitor.html` tab runs the standard MediaPipe detection loop and streams metrics back to the background script.
3.  **Finalization**: When the session stops, `background.js` calls `finalizeSession()`.
4.  **Local Save**: Instead of calling the `/api/v1/sessions` endpoint, the background script calls `saveGuestSession()`, which prepends the metrics to a `guestSessions` array in local storage.

## 4. Data Schema (Local Storage)

Guest sessions are stored as an array of objects under the `guestSessions` key:

```json
{
  "guestSessions": [
    {
      "timestamp": 1682345678901,
      "durationMinutes": 45.5,
      "blinkRate": 12.4,
      "blinkCount": 560,
      "fatigueScore": 32,
      "drowsyEvents": 1
    }
  ]
}
```

*Note: The history is currently capped at the latest 50 sessions to optimize storage usage.*

## 5. Guest Analytics

The Guest Analytics page (`guest-analytics.html`) is a standalone dashboard for visualizing local data.

- **Library**: Uses `Chart.js` (bundled locally in `lib/chart.umd.js` for offline support and security).
- **Security**: Complies with Manifest V3 Content Security Policy (CSP) by utilizing an external logic file (`guest-analytics.js`) instead of inline scripts.
- **Visualization**: Renders line charts for Blink Rate and Fatigue trends, and bar charts for session duration.

## 6. Security & Privacy

- **On-Device Only**: No data collected in Guest Mode is ever sent to the DevWell servers.
- **CSP Compliance**: All scripts are externalized, and `wasm-unsafe-eval` is used only where required by the MediaPipe engine.
- **Data Control**: Users can clear their entire local history at any time using the "Clear History" button in the popup dashboard.
