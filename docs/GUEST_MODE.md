# Guest Mode Technical Documentation

Guest Mode provides a privacy-focused, local-only experience for DevWell users who prefer not to create an account. This document outlines the implementation, data flow, and behavior of Guest Mode in the Chrome extension.
Last Updated: 2026-04-27

## 1. Architecture Overview

Guest Mode bypasses JWT login and allows monitoring without backend auth.

### Key Components
- `popup.js`: manages login/guest UI transitions and guest analytics access.
- `background.js`: orchestrates sessions, finalization, alerts, and local guest persistence.
- `monitor.js`: runs camera + MediaPipe detection and streams metrics to background.
- `chrome.storage.local`: stores guest state and session history.

## 2. State Management

Guest Mode state is persisted as `guestModeActive` in `chrome.storage.local`.

- Entering Guest Mode:
  - Triggered by "Continue as Guest" in popup login section.
  - Sets `guestModeActive: true`.
- Exiting Guest Mode:
  - Triggered by "Exit Guest" (shared logout button).
  - Sets `guestModeActive: false`.
  - Stops active session if one is running.
- Auto-cleanup:
  - Successful extension login sets `guestModeActive: false`.

## 3. Session Lifecycle (Guest)

1. Start request:
  - `requestStartSession` is allowed when `guestModeActive` is true (even without token).
2. Monitoring:
  - `monitor.html` runs detection and sends `monitorStarted` + `monitorMetrics`.
3. Finalization:
  - Background finalizes through the same unified path used by authenticated mode.
4. Local save:
  - Background calls `saveGuestSession()` instead of `/api/v1/sessions`.
5. Alert outcome:
  - A `session_saved` alert is pushed with guest-local save messaging.

## 4. Data Schema (Local Storage)

Guest sessions are stored as an array under `guestSessions`:

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

Notes:
- Newest sessions are prepended.
- History is capped at latest 50 sessions.

## 5. Guest Dashboard and Controls (Popup)

In Guest Mode popup UI:
- Session controls remain available (start/end).
- "View Analytics" opens `guest-analytics.html`.
- Exiting guest mode clears extension recent alerts.

## 6. Guest Analytics Page

`guest-analytics.html` is a standalone local analytics dashboard.

- Data source: `guestSessions` from `chrome.storage.local`.
- Library: bundled `Chart.js` (`lib/chart.umd.js`).
- Period tabs: weekly (last 7 days) and monthly (last 30 days).
- Visuals:
  - Blink Rate trend (line)
  - Fatigue Score trend (line)
  - Session Duration trend (bar)
- Additional summary/insight cards are computed client-side.
- Header includes `Clear All Sessions` to remove `guestSessions` from local storage.

## 7. Security & Privacy

- On-device only: guest session data is not uploaded to DevWell servers.
- CSP compliant: scripts are externalized (no inline script dependency).
- MediaPipe compatibility: `wasm-unsafe-eval` is used only where required by engine runtime.
