# DevWell Technical Reference

This document provides a deep dive into the technical architecture, deployment strategies, and API specifications for the DevWell platform.

## 🏗️ Technical Details

### Detection Pipeline

```
Camera Stream → MediaPipe Face Mesh → Eye Landmarks → EAR Calculation
                        ↓
                  Blink Detection (50ms - 1500ms)
                        ↓
                  Drowsiness Event (≥1500ms)
                        ↓
                  Fatigue Score Calculation
                        ↓
                  Classification + Notifications
```

| Parameter | Default Value | Description |
|-----------|---------------|-------------|
| Blink Duration | 50ms - <1500ms | Valid blink window |
| Drowsiness Threshold | ≥1500ms | Long-eye-closure event |
| Refractory Period | Configurable | Prevents duplicate detections |
| Processing FPS | 30 (visible), 2 (hidden) | Background tab throttling |

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
