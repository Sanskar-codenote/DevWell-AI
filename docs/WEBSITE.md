# DevWell Website Documentation

This document is the source of truth for the web app (`frontend/`) and API (`backend/`) behavior.
Last Updated: 2026-04-27

## 1. What The Website Does

DevWell Website is a React + TypeScript app that lets authenticated users:
- Run fatigue monitoring sessions directly in the browser.
- View real-time metrics (blink count, blink rate, fatigue score, drowsy events).
- Save completed sessions to the backend.
- Review weekly/monthly analytics and session history.
- Configure fatigue/break notification settings.
- Integrate with the Chrome extension in mirror mode when extension monitoring is active.

Privacy model:
- Camera processing is local on the client.
- The backend only receives numeric session summaries.
- No video frames or facial landmarks are uploaded.

## 2. Architecture

## Frontend
- Framework: React 19 + TypeScript + Vite.
- Primary contexts:
  - `AuthContext`: auth token lifecycle, user profile, extension-auth mismatch checks.
  - `SessionContext`: fatigue session ownership, multi-tab sync, alerts, extension bridging.
- Core engine:
  - `FatigueEngine` in `frontend/src/lib/fatigueEngine.ts`.
- Main routes:
  - `/dashboard`, `/analytics`, `/settings`

## Backend
- Framework: Express 5 + PostgreSQL.
- Auth: JWT bearer tokens.
- Routes:
  - `/api/v1/auth`
  - `/api/v1/sessions`
  - `/api/v1/analytics`

## 3. Authentication Flow

- On login/register, backend returns JWT + user payload.
- Token is stored in `localStorage` as `devwell_token`.
- `AuthContext` validates with `GET /api/v1/auth/me`.
- On invalid token/logout:
  - User state is cleared.
  - Persisted session keys are cleared.

Website also publishes auth state to DOM for extension sync:
- Attribute: `data-devwell-extension-auth`
- Payload includes `loggedIn` and `email`.

Account consistency behavior:
- Website login/register is blocked if the extension is logged in with a different email.

## 4. Session Engine (Website Mode)

The website engine uses webcam + MediaPipe FaceMesh to detect blinks and fatigue.

### Detection logic
- EAR-based eye state classification.
- Blink thresholds:
  - Blink: `50ms` to `<1500ms`
  - Drowsy event: `>=1500ms`
- Refractory and stability guards:
  - Blink refractory: `80ms`
  - Reopen stability: `90ms`

### Background/minimized behavior
- Uses `requestAnimationFrame` when visible.
- Uses hidden-tab fallback scheduling + `ImageCapture` loop when available.
- Falls back to timer mode if `ImageCapture` is unavailable.

### Fatigue scoring
Score is bounded `0..100` and combines:
- Blink deficit penalty.
- Long eye-closure penalty.
- Session duration penalty.

Levels:
- `Fresh`
- `Moderate Fatigue`
- `High Fatigue`

## 5. Session Ownership and Multi-Tab Behavior

Only one browser tab owns a live website session at a time.

Storage keys (localStorage):
- `devwell_active_session`
- `devwell_session_data`
- `devwell_session_owner`
- `devwell_shared_session`
- `devwell_session_command`

Behavior:
- Owner tab runs engine and heartbeats shared state.
- Non-owner tabs mirror metrics.
- If owner disappears, a visible follower tab can take over.
- On reload with orphaned state, session is cleaned and user is prompted to start again.

## 6. Extension Integration (Website Side)

When extension is available and authoritative:
- Website switches to extension-mirrored metrics.
- Dashboard shows extension-active UX and defers primary control to extension popup.
- Website exchanges state through DOM attributes:
  - `data-devwell-extension-state`
  - `data-devwell-extension-auth`
  - `data-devwell-extension-command`

Current command usage from website side:
- `stop` and `ping` are actively used in extension-controlled mode.

## 7. Settings Sync

Website settings are saved in local storage under `userSettings` and include:
- `lowFatigueThreshold`
- `highFatigueThreshold`
- `fatigueNotificationIntervalMinutes`
- `enableModerateFatigueNotification`
- `enableHighFatigueNotification`
- `enableBreakNotification`

Sync behavior:
- Website -> extension via `syncWebsiteSettings` runtime message (with storage fallback).
- Extension -> website via content-script `syncSettings` message and `window.postMessage` (`DEVWELL_SETTINGS_SYNC`).

## 8. Alerts

Website alerts include:
- Fatigue moderate/high.
- Break reminders.
- Save failures.
- Informational ownership/session continuity messages.

High-fatigue alert includes optional sound cue and browser notification (if granted).

## 9. Backend API Contract

## Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me` (auth required)

## Sessions
- `POST /api/v1/sessions` (auth required)
  - Body: `session_date`, `duration_minutes`, `avg_blink_rate`, `fatigue_score`, `long_closure_events`
- `GET /api/v1/sessions?limit=&offset=` (auth required)

## Analytics
- `GET /api/v1/analytics/weekly` (auth required)
- `GET /api/v1/analytics/monthly` (auth required)

## Health
- `GET /api/health`

## 10. Local Development

Requirements:
- Node.js
- PostgreSQL
- `.env` for backend (including `JWT_SECRET`, DB config)

Run backend:
```bash
cd backend
npm install
npm start
```

Run frontend:
```bash
cd frontend
npm install
npm run dev
```

Default local URLs:
- Frontend: `http://localhost:5173` (or `5174`)
- Backend: `http://localhost:3001`

## 11. Operational Notes

- CORS allows localhost web origins and Chrome extension origins.
- If `EXTENSION_ID` is set, only that extension origin is accepted.
- Production-only request rate limiting is applied under `/api/`.
- Session save happens at session stop; analytics read from stored session summaries.
