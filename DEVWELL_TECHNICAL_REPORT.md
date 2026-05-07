# DevWell Technical Reference

This document describes the current technical architecture, runtime behavior, deployment model, and API contracts for DevWell.

## 1. System Overview

DevWell is a privacy-first fatigue monitoring platform with three core parts:

1. Frontend Web App (`frontend/`): React + TypeScript dashboard, analytics, and settings.
2. Browser Extension (`chrome-extension/`): real-time camera monitoring and cross-tab/browser runtime logic.
3. Backend API (`backend/`): Express + PostgreSQL for auth and session analytics.

All face/blink processing is local in-browser via MediaPipe. No camera frames are uploaded.

## 2. AI and Detection Stack

### 2.1 MediaPipe Runtime

- Model: MediaPipe Face Landmarker (WASM)
- Inputs: camera frames
- Outputs used by DevWell:
  - 3D face landmarks (for head pitch validation)
  - Blendshape scores `eyeBlinkLeft`, `eyeBlinkRight` (for eye closure and blink logic)

### 2.2 Detection Pipeline

```text
Camera Stream -> Face Landmarker (WASM)
                 -> Blendshapes + Landmarks
                 -> Eye Closure / Blink Events
                 -> PERCLOS + Burst + Variability Signals
                 -> Fatigue Score (0-100)
                 -> Alerts + Session Metrics
```

## 3. Runtime Parameters (Current)

| Parameter | Value | Purpose |
|---|---:|---|
| Blink minimum duration | >= 35ms | Minimum closure duration for blink classification |
| Blink refractory period | 80ms | Prevent duplicate rapid recounting |
| Drowsiness threshold | >= 1500ms | Long eye closure event |
| PERCLOS window | 60s | Rolling window for eye-closure percentage |
| Head pitch valid range | -20deg to +30deg | Reject unstable pose frames |
| Looking-down transition threshold | > 25deg (with hysteresis) | Attention-state transition |
| Attention hysteresis | 800ms | Stabilize state transitions |
| Auto-pause (visible) | 20s no face | Pause active scoring when absent |
| Auto-pause (hidden/minimized) | 90s no face | More tolerant in throttled states |

## 4. Eye Closure and Blink Classification

DevWell uses adaptive blendshape gates (not a single fixed threshold):

Eyes are treated as closed if any rule matches:

- both eyes > 0.35
- left > 0.55 and right > 0.2
- right > 0.55 and left > 0.2

Additional blink classification rules:

- Valid blink closure must be >= 35ms and < 1500ms
- Long closure (>= 1500ms) contributes to drowsiness/acute closure signals
- Refractory filtering (80ms) prevents duplicate blink registration

## 5. Attention-State Gating

States:

- `ATTENTIVE`
- `LOOKING_DOWN`
- `FACE_LOST`

Rules:

- Pose transitions are hysteresis-stabilized (800ms)
- When state is not `ATTENTIVE`, closure/PERCLOS tracking is reset to avoid polluted signals
- Fatigue confidence scaling:
  - `ATTENTIVE`: 1.0
  - `LOOKING_DOWN`: 0.3
  - `FACE_LOST`: 0.0

## 6. Fatigue Scoring Algorithm (0-100)

### 6.1 Live Runtime Score (`emitState` path)

Live score is a weighted, clamped, confidence-gated, and smoothed signal.

Components:

| Factor | Max Weight | Logic |
|---|---:|---|
| PERCLOS (sigmoid) | 25 | `sigmoid(((perclos/25) - 0.5) * 6) * 25` |
| Blink deficit | 30 | `max(0, (referenceRate - currentBlinkRate)/referenceRate) * 30` |
| Blink variability | 15 | `min(stdDev(blinkIntervals)/2000, 1) * 15` |
| Acute closures | 15 | `min(longClosureEvents * 5, 15)` |
| Duration accumulation | 20 | `(1 - exp(-sessionMinutes/60)) * 20` |
| Micro-burst penalty | 10 | `min(recentClosures(last 10s) * 3, 10)` |

Post-processing:

1. Raw score is clamped to `0..100`
2. Confidence gating applied by attention state
3. Smoothed with EMA-like adaptation:
   - `smoothed += (raw - smoothed) * 0.05` (max once per second)
4. Recovery dampening:
   - If `perclos < 5`, `currentBlinkRate >= referenceRate`, and `longClosureEvents == 0`, then `smoothed *= 0.97`
5. Final score:
   - `fatigueScore = round(smoothed)`

Level thresholds:

- `> 70`: High Fatigue
- `> 40`: Moderate Fatigue
- else: Fresh

### 6.2 Final Session Summary Score (`stop()` path)

When a session stops, returned summary uses a separate simplified formula:

| Factor | Logic |
|---|---|
| Blink deficit | `0` if session `< 1 min`; else `max(0, (lowBlinkRate - currentBlinkRate)/lowBlinkRate) * 30` |
| PERCLOS weight | `(perclos / 25) * 40` |
| Acute closures | `min(longClosureEvents * 5, 20)` |
| Closure penalty | `min(perclosWeight + acuteClosureWeight, 80)` |
| Duration penalty | `min(max(sessionMinutes - 3, 0) / 120 * 20, 20)` |
| Final score | `clamp(blinkDeficit + closurePenalty + durationPenalty, 0, 100)`, then rounded |

Level thresholds are the same (`>70`, `>40`).

## 7. Background, Minimized, and Overlapped Runtime

Current runtime uses a watchdog-backed continuous capture loop with provider fallback:

1. `MediaStreamTrackProcessor` reader (preferred)
2. `ImageCapture.grabFrame()` fallback
3. video/canvas frame draw fallback

This is designed to preserve blink tracking across:

- active foreground tabs
- hidden tabs
- minimized windows
- overlapped windows (occluded by other apps)

## 8. Session Controls and Time Accounting

- Manual pause: camera stops, wake lock released, active-time accumulation paused
- Auto-pause:
  - visible: 20s no face
  - hidden/minimized: 90s no face
- Auto-resume: resumes on detected face when paused automatically
- Session duration metrics subtract total paused time

## 9. Data Model (PostgreSQL)

### 9.1 `users`

- `id` (PK)
- `email` (unique)
- `encrypted_password`
- `created_at`
- `updated_at`

### 9.2 `sessions`

- `id` (PK)
- `user_id` (FK -> users.id)
- `session_date` (DATE)
- `duration_minutes` (REAL)
- `avg_blink_rate` (REAL)
- `fatigue_score` (REAL)
- `long_closure_events` (INTEGER)
- `created_at`
- `updated_at`

### 9.3 `otp_codes`

- `id` (PK)
- `email`
- `code`
- `purpose`
- `expires_at`
- `used`
- `created_at`

## 10. Backend Security and Production Controls

Implemented:

- Helmet security headers
- CORS allowlist + extension-origin filtering
- Auth and OTP rate limiting
- JWT auth middleware
- Structured logging with pino
- Health endpoint (`/api/health`)

Production checks enforced:

- `JWT_SECRET` required, non-placeholder, min length 32
- `DB_PASSWORD` required
- `CORS_ALLOWED_ORIGINS` required
- `EXTENSION_ID` required

## 11. Browser Compatibility

Supported:

- Chromium-based browsers (Chrome, Edge, Brave)
- Firefox (dedicated extension build)

Not targeted for extension parity:

- Safari / iOS

## 12. API Reference (Current)

Base path: `/api/v1`

### 12.1 Auth

#### Register

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"strongPass123","otp":"123456"}'
```

#### Login

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"strongPass123"}'
```

#### Current User

```bash
curl -X GET http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer <token>"
```

### 12.2 Sessions

#### Create Session

```bash
curl -X POST http://localhost:3001/api/v1/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "session_date":"2026-05-07",
    "duration_minutes":42.5,
    "avg_blink_rate":14.2,
    "fatigue_score":58,
    "long_closure_events":1
  }'
```

#### List Sessions

```bash
curl -X GET "http://localhost:3001/api/v1/sessions?limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

### 12.3 Analytics

#### Weekly

```bash
curl -X GET http://localhost:3001/api/v1/analytics/weekly \
  -H "Authorization: Bearer <token>"
```

#### Monthly

```bash
curl -X GET http://localhost:3001/api/v1/analytics/monthly \
  -H "Authorization: Bearer <token>"
```

## 13. Docker and Operations

### 13.1 Environment

Use `.env.docker.example` as base and set all required values.

Minimum production variables:

- `JWT_SECRET`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_HOST`
- `DB_PORT`
- `CORS_ALLOWED_ORIGINS`
- `EXTENSION_ID`

### 13.2 Operational Checklist

- Strong secrets configured
- TLS/HTTPS via reverse proxy
- Health checks passing
- DB backups scheduled and restore-tested
- Logs monitored and retention policy defined

### 13.3 Useful Commands

```bash
docker compose logs -f
docker compose logs -f backend
docker compose up -d --build
docker compose down
docker compose down -v  # destroys DB volume
```

## 14. Privacy Guarantees

- Face processing is local to the device
- Camera frames are not sent to backend
- Backend stores numeric summaries only
- Guest mode can operate without account storage
