# DevWell AI

Real-time developer wellness monitoring app with webcam-based fatigue detection, session tracking, and analytics.

## Project Structure

- `frontend/` — React + TypeScript + Vite + Tailwind UI
- `backend/` — Express + PostgreSQL API
- `prd.md` — product requirement notes

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- React Router
- Axios
- Recharts
- Lucide icons
- MediaPipe FaceMesh (client-side eye landmark detection)

### Backend

- Node.js + Express 5
- PostgreSQL (`pg`)
- JWT authentication (`jsonwebtoken`)
- Password hashing (`bcryptjs`)
- CORS and rate limiting (`cors`, `express-rate-limit`)

## Working Flow

1. User registers/logs in.
2. JWT token is stored in `localStorage` (`devwell_token`).
3. User starts a monitoring session from Dashboard.
4. Frontend opens webcam and runs MediaPipe FaceMesh in browser.
5. Eye landmarks are converted to EAR (Eye Aspect Ratio) and classified into:
   - blink events
   - long closure events (drowsy events)
6. Real-time state is shown on Dashboard.
7. When session ends, summary is posted to backend (`/api/v1/sessions`).
8. Analytics tab loads weekly/monthly aggregates from backend.

## Tabs and What They Show

## Dashboard Tab

### Session controls

- **Start Session**: initializes webcam + detection engine.
- **End Session**: stops detection and saves summary to backend.

### Camera + Eye status

- Live camera feed (mirrored).
- `Eye Status` shows `Open`/`Closed` based on EAR thresholding.

### Live metrics

- **Session Time**: elapsed session duration.
- **Current Blink Rate (60s)**: blinks counted in the most recent 60 seconds.
- **Session Avg Rate**: `total_blinks / session_minutes` (smoothed in first minute for stable UI).
- **Total Blinks**: cumulative blink count in current session.
- **Drowsy Events**: count of long eye-closure events.
- **Fatigue Score (0-100)** + fatigue level badge:
  - `Fresh`
  - `Moderate Fatigue`
  - `High Fatigue`

### Fatigue score calculation (frontend engine)

Fatigue score combines three penalties:

- **Blink deficit penalty**: based on low current blink rate vs threshold.
- **Closure penalty**: based on long closure (drowsy) events.
- **Duration penalty**: increases gradually as session duration grows.

Final score is clamped to `0..100` and mapped to level:

- `<= 40`: Fresh
- `41..70`: Moderate Fatigue
- `> 70`: High Fatigue

### Alerts/notifications behavior

- Closure-based popup notifications are disabled.
- Fatigue notifications are sent when level reaches:
  - `Moderate Fatigue`
  - `High Fatigue`
- Alert interval is throttled to once per **1 hour**.
- `High Fatigue` notification includes sound alert.

## Analytics Tab

Data comes from backend endpoints:

- `GET /api/v1/analytics/weekly`
- `GET /api/v1/analytics/monthly`
- `GET /api/v1/sessions?limit=50`

### Weekly view

Shows:

- Average fatigue score
- Fatigue change vs previous week
- Average blink rate
- Longest session
- Daily charts (fatigue and blink rate)

### Monthly view

Shows:

- Weekly trend for last 4 weeks
- High fatigue days (score > 70)
- Burnout risk (`LOW`/`MEDIUM`/`HIGH`) derived from:
  - consecutive weekly fatigue increases
  - average session duration
- Daily monthly breakdown

## API Overview

Base path: `/api/v1`

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /sessions`
- `GET /sessions`
- `GET /analytics/weekly`
- `GET /analytics/monthly`

Health check:

- `GET /api/health`

## Database Schema

Tables initialized by backend startup:

- `users`
  - `id`, `email`, `encrypted_password`, timestamps
- `sessions`
  - `id`, `user_id`, `session_date`, `duration_minutes`, `avg_blink_rate`, `fatigue_score`, `long_closure_events`, timestamps

## Environment and Prerequisites

- Node.js 18+
- npm
- PostgreSQL

Backend uses these env vars (with defaults in `backend/db.js`):

- `DB_USER` (default: `dev16`)
- `DB_HOST` (default: `/var/run/postgresql`)
- `DB_NAME` (default: `devwell_dev`)
- `DB_PORT` (default: `5432`)
- `JWT_SECRET` (**required for auth**)
- `PORT` (default: `3001`)

Create `backend/.env` (example):

```env
JWT_SECRET=change_this_to_a_strong_secret
DB_USER=dev16
DB_HOST=/var/run/postgresql
DB_NAME=devwell_dev
DB_PORT=5432
PORT=3001
```

## How to Start (Frontend + Backend)

## 1) Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

## 2) Start backend

```bash
cd backend
npm start
```

Backend runs on: `http://localhost:3001`

## 3) Start frontend

```bash
cd frontend
npm run dev
```

Frontend runs on Vite default: `http://localhost:5173`

Vite proxy forwards `/api` to backend (`http://localhost:3001`).

## Optional: Seed demo data

```bash
cd backend
npm run seed
```

Creates demo account:

- email: `demo@devwell.ai`
- password: `demo123`

## Build Commands

### Frontend production build

```bash
cd frontend
npm run build
```

### Frontend preview build

```bash
cd frontend
npm run preview
```

## Common Dev Management

### Restart backend

```bash
cd backend
npm start
```

### Restart frontend dev server

```bash
cd frontend
npm run dev
```

### If token/session gets stuck

- Clear `devwell_token` from browser local storage.
- Re-login from `/login`.

## Notes

- Fatigue detection is computed client-side from webcam landmarks.
- Session persistence is maintained across Dashboard/Analytics route switches.
- Session summary is saved only when session ends.
