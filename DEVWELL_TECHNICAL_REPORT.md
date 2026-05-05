# DevWell Technical Reference

This document provides a deep dive into the technical architecture, deployment strategies, and API specifications for the DevWell platform.

## 🏗️ Technical Details

### Detection Pipeline

```
Camera Stream → MediaPipe Face Mesh → Blendshapes & Landmarks
                        ↓
          ┌─────────────┴─────────────┐
          ↓                           ↓
    Blink Detection            PERCLOS Tracking
    (Blendshape Score > 0.5)   (60s rolling window)
          ↓                           ↓
    Drowsiness Event           Fatigue Score Calculation
    (≥1500ms / Microsleep)     (Multi-factor Weighted Sum)
                        ↓
          Classification + Notifications
```

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| Eye Closure Threshold | > 0.5 | Blendshape score threshold for "eyes closed" |
| Drowsiness Threshold | ≥1500ms | Long-eye-closure event (Microsleep) |
| PERCLOS Window | 60 seconds | Rolling window for closure percentage |
| High Fatigue (PERCLOS) | 25% | Revised threshold for high fatigue contribution |
| Refractory Period | 80ms | Prevents duplicate detections |
| Head Pitch Limit | -20° to +30° | Valid attention range before state reset |

### Database Schema (PostgreSQL)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | id, email, password_hash |
| `sessions` | Monitoring sessions | user_id, session_date, duration_minutes |
| `sessions` | Session metrics | avg_blink_rate, fatigue_score, long_closure_events |

---

## 👥 User Types & Features

DevWell provides two modes of operation to balance privacy and convenience:

### 👤 Registered User
**Best for:** Developers who want long-term progress tracking and cross-tab synchronization.
- **Persistent Analytics**: All session metrics are securely stored in the PostgreSQL database for weekly/monthly trend analysis.
- **Cross-Tab Synchronization**: Start a session in one tab, see live metrics and control it from any other DevWell tab or the extension popup.
- **Bidirectional Settings Sync**: Change your "Low Blink Rate Threshold" or notification preferences in the extension popup and they instantly sync to the web dashboard (and vice versa).
- **Advanced Controls**: Manual "Pause / Take Break" functionality with hardware camera release.

### 👤 Guest User (Local-only)
**Best for:** Quick setup or users who prefer 100% local data storage.
- **Full Privacy**: No account required. All monitoring happens entirely within your browser.
- **Local Analytics**: View your recent session history via the specialized "Guest Analytics" view (stored in `chrome.storage.local`).
- **Real-time Monitoring**: Access to the full fatigue engine, including blink detection and 20-20-20 break reminders.
- **Data Boundary**: Data is limited to the current browser profile and is not synced across devices or browsers.

---

## 🧠 Session Management & Fatigue Logic

### Fatigue Scoring Algorithm (0-100)
The fatigue score is a multi-factor weighted sum designed to provide a scientifically grounded assessment of developer alertness, dynamically adapting to each user.

| Factor | Max Weight | Logic |
|--------|------------|-------|
| **PERCLOS (Sigmoid)** | 25 pts | Primary driver. Normalized against a 25% window and scaled using a Sigmoid curve for a natural progression. |
| **Relative Blink Deficit**| 30 pts | Penalty calculated against a **Personalized Baseline** (learned in the first 3 minutes of a session). |
| **Blink Variability** | 15 pts | Penalty based on the Standard Deviation of recent blink intervals, detecting erratic blinking patterns. |
| **Acute Closures** | 15 pts | Penalty for discrete long-closure events (microsleeps). |
| **Duration (Exp)** | 20 pts | Exponential fatigue accumulation based on session active time. |
| **Micro-Bursts** | 10 pts | Penalty for rapid, successive bursts of closures within a 10-second window. |

*Note: The total score is capped at 100 and smoothed via a Momentum-Based Physiological Model (with active recovery when alert).*

### Robustness & False Positive Mitigation

The DevWell engine utilizes a combination of 3D physical geometry and AI expression analysis to provide accurate fatigue tracking while rejecting noise.

#### 1. Head Pitch (Up/Down Detection)
*   **What we check:** The vertical tilt of the head (pitch) to determine if the user is looking at their screen, tucked down (e.g., looking at a keyboard), or tilted too far back.
*   **How we check it:**
    *   We use three anchor landmarks: **Chin** (152), **Forehead** (10), and the **Nose**.
    *   Treating the face as a 3D vector, we calculate the difference in height (Y-axis) and depth (Z-axis) between the forehead and the chin.
    *   Using `Math.atan2(deltaZ, deltaY)`, we extract the true angle of the face relative to the camera in degrees.
    *   **Rules:** If the angle is **> 25°**, the state becomes `LOOKING_DOWN`. If the angle is extreme (**> 30° or < -20°**), the frame is rejected entirely as "unstable."

#### 2. Eye Closure (Blendshape Detection)
*   **What we check:** We use "Blendshapes" (high-level AI classifications of facial expressions) rather than measuring raw distances between eyelids, making it highly resistant to perspective distortion.
*   **How we check it:**
    *   We evaluate the `eyeBlinkLeft` and `eyeBlinkRight` categories from the Face Landmarker, which range from **0.0** (fully open) to **1.0** (fully closed).
    *   **Rules:** We require **both** eyes to have a score **> 0.5** to count as "Closed." This prevents winking or natural asymmetrical squinting from being miscounted.
    *   **Noise Filtering:** A closure is only recorded for PERCLOS calculation if it lasts at least **200ms** and is captured across at least **3 consecutive frames**.

#### 3. Attention State Machine (Hysteresis & Gating)
*   **What we check:** We determine if the incoming data stream is clean enough to be used for accurate tracking.
*   **How we check it:**
    *   **Hysteresis (800ms):** If a user looks down briefly, the system remains in `ATTENTIVE`. The pose must be held for a full **800ms** before officially switching to `LOOKING_DOWN` or `FACE_LOST`.
    *   **Hard Data Gating:** The moment the state leaves `ATTENTIVE`, a hard reset is triggered. The current rolling window of eye closures is wiped, and PERCLOS is zeroed out. This ensures that partially closed eyes detected while looking down at a phone do not artificially inflate the fatigue score.

#### 4. PERCLOS (Drowsiness Metric)
*   **What we check:** The "Percentage of Eye Closure" over a rolling 60-second window.
*   **How we check it:**
    *   The `start` and `end` timestamps of every valid blink/closure are recorded.
    *   We sum the total milliseconds the eyes were closed in the last 60 seconds and divide by 60,000ms.
    *   **Rules:** If the eyes are closed for **25%** of a minute, the PERCLOS weight hits its maximum value (40 pts), signaling high drowsiness.

### Pause, Break, and Auto-Pause
DevWell incorporates robust session management to ensure fatigue scores are not artificially inflated during breaks or interruptions.

1.  **Manual Pause & Breaks:** The user can manually pause the session or start a break. This action immediately stops the camera stream and releases the hardware lock (turning off the webcam light) to ensure privacy and save power. The session timer and fatigue calculations are suspended.
2.  **Auto-Pause (Face Absence):** If no face is detected for 20 continuous seconds, the system triggers an `auto-pause`. The camera remains active (to detect when the user returns) but the fatigue score calculations and session timer are suspended to prevent false penalties.
3.  **Auto-Resume:** When the system is in an `auto-paused` state, the detection of a face automatically resumes the session timer and tracking. Manual pauses require manual resumes to prevent accidental re-engagement.
4.  **Timer Accuracy:** The `FatigueEngine` strictly accounts for `totalPausedTime`. The session duration used for calculating "Blinks Per Minute" and "Duration Penalty" is purely the active time, ensuring complete accuracy even if the session is left paused for hours.

### Configurable Thresholds
- **Dynamic Baselines:** The system allows the user to customize the "Low Blink Rate Threshold" (default: 15 BPM). The fatigue calculation dynamically scales penalties based on this user-defined target rather than a generic hardcoded value.

---

## 🐳 Docker Deployment Details

### Environment Configuration

Create `.env` from `.env.docker.example`:

```env
# Ports
FRONTEND_PORT=80
BACKEND_PORT=3001

# Security (REQUIRED)
JWT_SECRET=openssl_rand_-base64_64_generated_value

# Database (REQUIRED)
DB_USER=devwell
DB_PASSWORD=your_strong_password
DB_HOST=db
DB_NAME=devwell_production
DB_PORT=5432
DB_POOL_MAX=20

# CORS (REQUIRED in production)
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Chrome Extension (REQUIRED in production)
EXTENSION_ID=your_published_extension_id

# Logging
LOG_LEVEL=info
```

### Production Checklist

- [ ] Strong `JWT_SECRET` generated (`openssl rand -base64 64`)
- [ ] Strong `DB_PASSWORD` set
- [ ] `CORS_ALLOWED_ORIGINS` configured for production domains
- [ ] `EXTENSION_ID` set to published Chrome extension ID
- [ ] TLS/HTTPS configured via reverse proxy
- [ ] Database backup cron job configured
- [ ] `LOG_LEVEL` set appropriately (`info` for production, `debug` for staging)
- [ ] MediaPipe assets present in `frontend/public/mediapipe/` and `chrome-extension/lib/`

### Docker Stack Features

| Service | Image | Features |
|---------|-------|----------|
| **Frontend** | Nginx | Gzip, security headers, static asset caching |
| **Backend** | Node.js | Non-root user, signal handling, rate limiting |
| **Database** | PostgreSQL 16 Alpine | Health checks, persistent volume |

**Security:**
- Helmet headers
- CORS enforcement
- Rate limiting (100 req/15min API, 5 req/15min auth)
- Structured JSON logging (pino)

**Resource Limits:**
- Frontend: 256M RAM, 0.5 CPU
- Backend: 512M RAM, 1.0 CPU
- Database: 512M RAM, 1.0 CPU

### Database Backups

Automated backup script included at `scripts/backup-db.sh`:

```bash
# Manual backup
./scripts/backup-db.sh

# Automated daily backups (add to crontab)
# crontab -e
0 2 * * * cd /path/to/DevWell && ./scripts/backup-db.sh >> /var/log/devwell-backup.log 2>&1
```

Backups are:
- Gzipped
- Saved to `./backups/`
- Auto-cleaned after 30 days (configurable via `RETAIN_DAYS`)

### TLS/HTTPS

The Docker stack serves HTTP. For production HTTPS, use a reverse proxy:

```bash
# Caddy (recommended - automatic HTTPS)
caddy reverse-proxy --from yourdomain.com --to localhost:80

# Or configure Traefik/Nginx with Let's Encrypt
```

### Common Docker Commands

```bash
# View logs
docker compose logs -f              # All services
docker compose logs -f backend     # Backend only (JSON logs)

# Stop services
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Full reset (WARNING: deletes database)
docker compose down -v
```

---

## 📊 API Reference

### Authentication

```bash
# Register
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Login
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password"}'

# Get current user
curl -X GET http://localhost:3001/api/v1/auth/me \
  -H "Authorization: Bearer <token>"
```

### Sessions

```bash
# Create session
curl -X POST http://localhost:3001/api/v1/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"duration_minutes": 60, "avg_blink_rate": 15, "fatigue_score": 0.2}'

# List sessions
curl -X GET http://localhost:3001/api/v1/sessions \
  -H "Authorization: Bearer <token>"
```

### Analytics

```bash
# Weekly trends
curl -X GET http://localhost:3001/api/v1/analytics/weekly \
  -H "Authorization: Bearer <token>"

# Monthly trends
curl -X GET http://localhost:3001/api/v1/analytics/monthly \
  -H "Authorization: Bearer <token>"
```
