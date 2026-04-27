# DevWell Chrome Extension Documentation

This document is the source of truth for the Chrome extension (`chrome-extension/`) behavior.
Last Updated: 2026-04-27

## 1. What The Extension Does

The extension runs fatigue monitoring from a dedicated pinned monitor tab and surfaces metrics in:
- Extension popup UI.
- Website dashboard (mirrored state).

Core capabilities:
- Session start/stop from popup.
- Camera-based blink and fatigue detection.
- Session summary save to backend for authenticated users.
- Guest Mode (local-only session saving and guest analytics).
- Alert timeline with manual dismiss controls.
- Auth consistency checks between website and extension accounts.
- Settings synchronization between website and extension.

## 2. Main Components

- `manifest.json`
  - Manifest V3 config.
  - Service worker background script.
  - Popup.
  - Content script injection for website origins.
- `background.js`
  - Source of truth for extension session state.
  - Monitor tab lifecycle.
  - Session finalization + backend/local save.
  - Alerts and badge state.
  - Settings normalization and effective settings selection.
- `monitor.html` / `monitor.js`
  - Dedicated runtime for camera + MediaPipe Tasks Vision detection.
- `popup.html` / `popup.js` / `popup.css`
  - Login/logout, guest mode, start/stop, view analytics, metrics, recent alerts, settings UI.
- `content.js`
  - Bridge between website DOM attributes and extension state/auth.
  - Syncs settings updates to website.

## 3. Session Lifecycle

Start flow:
1. User logs into popup or enables Guest Mode.
2. Popup sends `requestStartSession` to background.
3. Background validates auth/account consistency (when logged in).
4. Background opens pinned `monitor.html` tab.
5. Monitor sends `monitorStarted` and periodic `monitorMetrics`.

Stop flow:
1. Popup sends `requestStopSession`.
2. Background asks monitor tab to stop gracefully.
3. Background finalizes session through one unified finalization path.
4. Monitor tab is closed automatically.
5. Session summary is saved:
   - Backend when authenticated.
   - `guestSessions` in `chrome.storage.local` when in Guest Mode.
6. Recent Alerts receives a save outcome entry.

User-closes-monitor-tab flow:
- `tabs.onRemoved` triggers finalization if session is active.

Popup quick actions:
- `Start Session` / `End Session`
- `View Analytics` (opens website analytics for logged-in users, guest analytics page for guest mode)
- `Settings` (available when logged in)

## 4. Detection Engine (Monitor Tab)

Monitor uses MediaPipe Tasks Vision (`vision_bundle.js` + `face_landmarker.task`).

Key behavior:
- EAR-based blink detection.
- Blink window: `50ms..1499ms`.
- Drowsy event: `>=1500ms` closure.
- Refractory and reopen-stability guards.
- Hidden/minimized support:
  - `requestAnimationFrame` when visible.
  - `ImageCapture` hidden loop when available.
  - Timer fallback when `ImageCapture` is unavailable.

## 5. Alerts and Notifications

Alerts are managed in background storage and rendered in popup.

Current behavior:
- Recent Alerts are capped to last 5 entries.
- Popup renders latest alerts in reverse chronological order.
- User can dismiss each alert via `×`.
- Alerts are cleared on extension logout.
- Alerts are also cleared when exiting Guest Mode.

Alert types include:
- `fatigue_moderate`, `fatigue_high`, `break`
- `session_saved`, `session_local_only`, `session_save_failed`, `session_error`, `session_ended`
- `auth_mismatch`

Chrome notifications are emitted for pushed alerts.

## 6. Auth Consistency Rule (Website vs Extension)

If both are logged in, emails must match.

Enforcement points:
- Popup checks mismatch before login/start actions.
- Background checks mismatch before `requestStartSession`.

If mismatch occurs:
- Session start is blocked.
- `auth_mismatch` alert is created.
- User sees clear error messaging in popup.

## 7. Settings Model

Supported settings:
- `lowFatigueThreshold`
- `highFatigueThreshold`
- `fatigueNotificationIntervalMinutes`
- `enableModerateFatigueNotification`
- `enableHighFatigueNotification`
- `enableBreakNotification`

Storage behavior:
- Extension-local preferences are stored in `extensionSettings`.
- Website-synced values are stored in `websiteSettings`.
- Effective settings priority:
  1. `extensionSettings`
  2. `websiteSettings`
  3. defaults

Sync behavior:
- Website -> extension: `syncWebsiteSettings` message to background.
- Extension -> website: popup sends `syncSettings` to website tabs via content script.

## 8. Data and Storage

Background-managed keys in `chrome.storage.local` include:
- `sessionActive`
- `sessionData`
- `alerts`
- `extensionAuth`
- `websiteAuth`
- `monitorTabId`
- `sessionError`
- `guestModeActive`
- `guestSessions`
- `extensionSettings`
- `websiteSettings`

Session save payload to backend:
- `session_date`
- `duration_minutes`
- `avg_blink_rate`
- `fatigue_score`
- `long_closure_events`

## 9. Website Bridge (Content Script)

Content script reads/writes DOM attributes:
- `data-devwell-extension-state`
- `data-devwell-extension-auth`
- `data-devwell-extension-command`

Responsibilities:
- Propagate extension session state to website.
- Read website auth into extension storage.
- Handle website commands (`stop`, `ping`).
- Forward settings sync messages to website (`DEVWELL_SETTINGS_SYNC`).

## 10. Permissions

From `manifest.json`:
- `permissions`: `storage`, `notifications`, `tabs`
- `host_permissions`: `<all_urls>`

Notes:
- Content script itself injects only on configured local app URLs.
- Broad host permission avoids popup "access required" blockers on unrelated pages.

## 11. Install and Run (Local)

1. Start backend:
```bash
cd backend
npm install
npm start
```
2. Load extension:
- Open `chrome://extensions`
- Enable Developer mode
- Load unpacked: `chrome-extension/`
- Pin extension
3. Open popup, log in (or continue as guest), and start session.

## 12. Troubleshooting

- Monitor tab not opening:
  - Check login/guest state in popup.
  - Check `requestStartSession` errors in service worker logs.
- Session not saving:
  - Verify backend running at `http://localhost:3001`.
  - Verify `extensionAuth.token` is present for cloud save.
- Account mismatch blocks start:
  - Ensure website and extension are logged in with same email.
- No metrics while hidden:
  - Verify camera permission in monitor tab.
  - Check monitor console for `ImageCapture` fallback warnings.
