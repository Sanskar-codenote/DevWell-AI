# DevWell - Product Requirements Document (PRD)

## Version
v1.1 (Implementation-aligned MVP)

## Document Owner
Product / Engineering

## Last Updated
2026-04-17

## Canonical References
- Website + backend behavior: `docs/WEBSITE.md`
- Chrome extension behavior: `docs/EXTENSION.md`

---

# 1. Product Overview

DevWell is a privacy-first developer wellness system with two runtimes:
- **Website** (React): real-time fatigue monitoring, session history, weekly/monthly analytics.
- **Chrome Extension**: a pinned monitor tab runs the camera + AI loop for stable monitoring, and mirrors metrics to both the popup and the website.

Privacy model:
- Facial processing stays on-device in the browser.
- Backend stores only aggregated session metrics (no video frames, no images, no landmarks).

---

# 2. Problem Statement

Developers frequently experience digital eye strain, reduced blink rate during long focused work, and progressive burnout due to lack of structured breaks. Existing solutions are mostly timer-based and do not use physiological indicators.

DevWell addresses this by combining:
- Real-time fatigue detection (blink/eye-closure signals)
- Break reminders (20-20-20 rule)
- Weekly/monthly analytics and trends

---

# 3. Product Goals

## Primary Goals
1. Detect fatigue signals in real time using webcam-based analysis.
2. Encourage healthier habits via break reminders and fatigue alerts.
3. Persist session summaries and provide weekly/monthly analytics.
4. Maintain strict privacy and minimize collected data.

## Success Metrics (MVP)
- Weekly active users
- Sessions per user per week
- Share of sessions successfully saved
- Analytics page usage (weekly/monthly views)

---

# 4. Target Users

- Remote developers working long hours.
- Startup engineers under sustained workload.
- Students in long study sessions.

---

# 5. Scope

## In Scope (MVP)
- JWT authentication (register/login)
- Webcam-based blink and drowsiness detection
- Fatigue score + fatigue levels
- Session start/stop and session persistence
- Backend storage of session summaries
- Weekly/monthly analytics
- Chrome extension runtime (pinned monitor tab) + website mirroring
- Alerting (fatigue + break reminders)

## Out of Scope (MVP)
- Storing video/images/landmarks
- Model training or personalization via server ML
- Team dashboards
- Mobile app

---

# 6. Functional Requirements

## 6.1 Authentication (API)

### FR-1: Register
- Users can register with email + password.
- Passwords must be securely hashed server-side.
- Server returns JWT token on success.

### FR-2: Login
- Users can log in with email + password.
- Server returns JWT token on success.

### FR-3: Authenticated API
- Protected endpoints require `Authorization: Bearer <token>`.

---

## 6.2 Monitoring Modes

DevWell supports two monitoring modes:
- **Website Mode**: monitoring runs inside the website tab.
- **Extension Mode**: monitoring runs inside the extension pinned monitor tab; website shows mirrored metrics (read-only).

### FR-4: Single-Owner Rule (Website Mode)
- Only one browser tab can own the live website session at a time.
- Other tabs must mirror the shared state and may take over if the owner becomes stale.

### FR-5: Extension Mode Mirror
- When extension monitoring is active, the website must not run a competing engine and should display extension metrics.

---

## 6.3 Webcam and AI Initialization

### FR-6: Webcam Permission
- Monitoring starts only after explicit user interaction and camera permission.
- If permission is denied, user receives a clear error.

### FR-7: On-Device Processing
- Facial analysis and detection must happen client-side (website/extension).
- No frames/images/landmarks are uploaded.

---

## 6.4 Blink and Drowsiness Detection (Algorithm Contract)

All runtimes (website + extension monitor tab) must support:
- EAR-based blink detection using eye landmarks.
- Blink classification by closure duration:
  - **Blink**: `>= 50ms` and `< 1500ms`
  - **Drowsy event**: `>= 1500ms`
- Reopen stability and refractory guards to reduce noise:
  - Reopen stability window (approx): `~90ms`
  - Blink refractory (approx): `~80ms`

Alert condition:
- Blink rate (last 60s) `< 8/min` (informational alerting, not blocking).

---

## 6.5 Fatigue Score

### FR-8: Fatigue Score Range
- Score is `0..100`.
- Score is derived from:
  - Blink deficit
  - Long eye-closure events
  - Session duration

### FR-9: Fatigue Levels
- `Fresh`: `0..40`
- `Moderate Fatigue`: `41..70`
- `High Fatigue`: `71..100`

---

## 6.6 Break Reminders

### FR-10: Break Reminder Policy
- Remind user to take a break based on elapsed session time (20-20-20 rule).

Channels:
- Website: in-app alert + optional browser notification (when permission granted).
- Extension: popup recent alerts + Chrome notification.

---

## 6.7 Session Lifecycle

### FR-11: Start Session
- Starts monitoring loop and session timer.
- Initializes calibration state.

### FR-12: Stop Session
- Stops monitoring loop, finalizes session summary.
- Attempts to save session summary to backend (if authenticated).

### FR-13: Extension Monitor Tab Lifecycle (Extension Mode)
- Starting a session opens a pinned `monitor.html` tab.
- Ending a session closes the pinned monitor tab automatically.

---

## 6.8 Account Consistency (Website vs Extension)

### FR-14: Same-User Requirement
- If both website and extension are logged in, the **email must match**.
- If mismatch is detected:
  - Extension session start must be blocked.
  - A clear error message must be shown.
  - A `auth_mismatch` alert should be recorded.

---

## 6.9 Alerts (Extension)

### FR-15: Recent Alerts UX
- Popup shows only the latest 5 alerts.
- Each alert has a manual dismiss button (`x`).
- Alerts are cleared on extension logout.

---

# 7. Backend Data Contract

## 7.1 Session Summary Payload

The backend stores only aggregated session summary fields:
```json
{
  "session_date": "2026-04-17T12:34:56.000Z",
  "duration_minutes": 180.0,
  "avg_blink_rate": 9.2,
  "fatigue_score": 72,
  "long_closure_events": 4
}
```

Notes:
- `session_date` is ISO 8601 (datetime). The database may store it as a date or timestamp depending on schema.
- `duration_minutes` may be fractional.

---

## 7.2 API Endpoints (MVP)

Auth:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

Sessions:
- `POST /api/v1/sessions` (save completed session)
- `GET /api/v1/sessions?limit=&offset=` (session history)

Analytics:
- `GET /api/v1/analytics/weekly`
- `GET /api/v1/analytics/monthly`

---

# 8. Burnout Risk (Rule-Based MVP)

Burnout risk levels: `LOW`, `MEDIUM`, `HIGH`.

MVP rule-based guidance:
- Consider risk higher when weekly fatigue increases across multiple weeks and average session duration is high (e.g., > 240 minutes).

---

# 9. Non-Functional Requirements

## Privacy
- Local-only processing for camera inference.
- Never store/upload video, images, or landmarks.
- Explicit user consent before webcam activation.

## Reliability
- Monitoring must remain functional across navigation (website) and tab switching/minimizing (extension pinned tab design).
- Background/minimized operation may be throttled by the browser; system must degrade gracefully and continue best-effort processing.

## Performance
- Aim for smooth real-time updates when visible.
- Minimize battery drain when hidden/minimized (background mode).

## Security
- JWT auth required for all user data endpoints.
- Clear logout behavior: clear session state to prevent cross-user leakage.

---

# 10. Technical Architecture (Implementation)

Frontend:
- React + TypeScript + Vite
- MediaPipe FaceMesh (website runtime)

Extension:
- Manifest V3
- Background service worker
- Dedicated pinned monitor tab (`monitor.html` + `monitor.js`)
- MediaPipe Tasks Vision assets bundled in extension

Backend:
- Node.js + Express API
- PostgreSQL
- JWT authentication

---

# 11. System Flows (High Level)

Website Mode:
1. User logs in.
2. User starts session from Dashboard.
3. Client runs detection locally.
4. User ends session; summary is saved.
5. Analytics computed from saved session summaries.

Extension Mode:
1. User logs in to website and extension with the same email.
2. User starts session from extension popup.
3. Background opens pinned monitor tab; monitor streams metrics.
4. Website mirrors extension metrics.
5. User ends session; pinned tab closes; save outcome appears in Recent Alerts.

---

# 12. Future Enhancements

- Posture detection
- Productivity correlation
- Editor integrations (VS Code)
- Team analytics dashboards
- Exportable reports
