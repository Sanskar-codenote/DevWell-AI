# DevWell

DevWell is a developer wellness platform that monitors blink behavior and fatigue in real time, then helps users review trends and take healthier breaks.

The repo contains:
- `frontend/`: React + TypeScript web app (dashboard, analytics, settings)
- `backend/`: Express + PostgreSQL API (auth, sessions, analytics)
- `chrome-extension/`: Manifest V3 extension with dedicated monitor tab and popup controls

## Canonical Documentation

Use these docs as source of truth for behavior and architecture:
- Website + backend: [docs/WEBSITE.md](docs/WEBSITE.md)
- Chrome extension: [docs/EXTENSION.md](docs/EXTENSION.md)
- Guest mode internals: [docs/GUEST_MODE.md](docs/GUEST_MODE.md)

## Current Capabilities

- Real-time fatigue monitoring using camera + MediaPipe face landmarks
- Blink detection and long-eye-closure (drowsiness) events
- Fatigue score and fatigue-level classification (`Fresh`, `Moderate Fatigue`, `High Fatigue`)
- Browser notifications and break reminders (20-20-20 rule)
- Configurable notification settings (thresholds, cooldown interval, toggles)
- Website analytics views (weekly/monthly trends + session history)
- Extension popup controls with recent alerts and status badge
- Dedicated pinned extension monitor tab for reliable background monitoring
- Guest mode in extension (local-only sessions + local guest analytics)
- Website <-> extension state bridge (extension state mirrored in website)
- Account mismatch protection when website and extension use different emails

## Key Technical Details

### Detection Pipeline
- Blink engine uses Eye Aspect Ratio (EAR) over MediaPipe eye landmarks.
- Default detection windows:
  - Blink: `50ms` to `<1500ms`
  - Drowsy event: `>=1500ms`
- Guards include refractory timing and reopen stability checks to reduce false positives.
- Hidden/minimized tab behavior:
  - Visible tab: `requestAnimationFrame`
  - Hidden tab: `ImageCapture` loop when available, timer fallback otherwise

### Website Session Model
- Single-owner multi-tab session model using localStorage ownership keys.
- Owner tab runs detection; follower tabs mirror shared state.
- Session cleanup handles reload/orphaned-stream scenarios safely.
- Extension-aware UI can switch to mirrored read-only mode when extension is authoritative.

### Extension Architecture
- `background.js` is source of truth for extension session lifecycle.
- Monitoring runs in `monitor.html` / `monitor.js` (not popup-bound), so switching tabs does not kill detection.
- Popup supports login/logout, start/stop, settings, alerts, and guest history controls.
- Content script bridges website DOM attributes for auth/session synchronization.

### Backend API and Storage
- Auth: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- Sessions: `POST /api/v1/sessions`, `GET /api/v1/sessions`
- Analytics: `GET /api/v1/analytics/weekly`, `GET /api/v1/analytics/monthly`
- PostgreSQL tables:
  - `users`
  - `sessions` (`session_date`, `duration_minutes`, `avg_blink_rate`, `fatigue_score`, `long_closure_events`)
- Request validation via Zod and JWT-based route protection.

## Local Development

### Prerequisites
- Node.js (LTS recommended)
- npm
- PostgreSQL

### Backend Environment
Create `backend/.env` with values like:

```env
PORT=3001
FRONTEND_PORT=5173
JWT_SECRET=your_strong_secret_here
DB_USER=dev16
DB_HOST=/var/run/postgresql
DB_NAME=devwell_dev
DB_PORT=5432
# Optional in local Unix socket setup
# DB_PASSWORD=postgres
# Optional: lock CORS to a specific published extension
# EXTENSION_ID=your_chrome_extension_id
```

### 1) Start Backend
```bash
cd backend
npm install
npm start
```

Optional demo seed:
```bash
cd backend
npm run seed
```

### 2) Start Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3) Load Extension (Optional)
- Open `chrome://extensions`
- Enable Developer mode
- Click **Load unpacked** and select `chrome-extension/`
- Pin extension for quick session control

Default local URLs:
- Frontend: `http://localhost:5173` (or `5174`)
- Backend: `http://localhost:3001`

## Docker

### Setup

1. Copy env template:
```bash
cp .env.docker.example .env
```

2. Edit `.env` with your values:
```env
FRONTEND_PORT=80
BACKEND_PORT=3001

# REQUIRED — generate a strong secret: openssl rand -base64 64
JWT_SECRET=<your-strong-secret>

DB_USER=devwell
DB_PASSWORD=<strong-db-password>
DB_HOST=db
DB_NAME=devwell_production
DB_PORT=5432
DB_POOL_MAX=20

# REQUIRED — your production domain(s), comma-separated
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# REQUIRED — your published Chrome extension ID
EXTENSION_ID=<your-extension-id>

LOG_LEVEL=info
```

3. Build and run:
```bash
docker compose up -d --build
```

4. Verify everything is healthy:
```bash
docker compose ps                       # All services should show "healthy"
curl http://localhost:3001/api/health    # Deep health check (verifies DB connectivity)
```

- Frontend: `http://localhost:80` (or your `FRONTEND_PORT`)
- Backend: `http://localhost:3001` (or your `BACKEND_PORT`)

### What the Stack Provides

| Feature | Detail |
|---|---|
| **Frontend** | Built React app served by Nginx with gzip, security headers, and 1-year static asset caching |
| **Backend** | Node.js running as non-root user (`appuser`) with `dumb-init` for proper signal handling |
| **Database** | PostgreSQL 16 Alpine with health checks and persistent volume |
| **Security** | Helmet headers, CORS enforcement, rate limiting (100 req/15min API, 5 req/15min auth) |
| **Logging** | Structured JSON logs via pino (pretty-printed in dev, JSON in production) |
| **Health checks** | All 3 services have Docker health checks; backend deep-checks DB connectivity |
| **Resource limits** | Memory and CPU limits per service |
| **Env validation** | Backend fails fast on startup if required env vars are missing or JWT_SECRET is a default value |

### Database Backups

A backup script is included at `scripts/backup-db.sh`:

```bash
# Manual backup
./scripts/backup-db.sh

# Automated daily backups (add to crontab)
# crontab -e
0 2 * * * cd /path/to/DevWell && ./scripts/backup-db.sh >> /var/log/devwell-backup.log 2>&1
```

Backups are gzipped and saved to `./backups/`. Old backups are automatically cleaned after 30 days (configurable via `RETAIN_DAYS`).

### TLS/HTTPS

The Docker stack serves over HTTP. For production HTTPS, place a reverse proxy in front:

- **Caddy** (recommended, automatic HTTPS): `caddy reverse-proxy --from yourdomain.com --to localhost:80`
- **Traefik**: Add as a service in docker-compose with Let's Encrypt integration
- **Cloud provider**: Use your provider's load balancer with TLS termination (AWS ALB, GCP LB, etc.)

### View Logs

```bash
docker compose logs -f             # All services
docker compose logs -f backend     # Backend only (JSON structured logs)
```

### Stopping / Rebuilding

```bash
# Stop all services
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Full reset (WARNING: deletes database data)
docker compose down -v
```

## Privacy Model

- Camera processing is local on device.
- Backend receives only numeric session summaries.
- No video frames or face landmark arrays are uploaded.
- In Guest Mode, session data stays local in extension storage.

## Production Checklist

- [ ] Strong `JWT_SECRET` set (not the default value)
- [ ] Strong `DB_PASSWORD` set
- [ ] `CORS_ALLOWED_ORIGINS` set to your production domain(s)
- [ ] `EXTENSION_ID` set to your published Chrome extension ID
- [ ] TLS/HTTPS configured via reverse proxy
- [ ] Database backup cron job set up
- [ ] `LOG_LEVEL` set appropriately
- [ ] Keep local MediaPipe assets packaged:
  - Frontend: `frontend/public/mediapipe/`
  - Extension: `chrome-extension/lib/`

## Package Quick Links

- Frontend package readme: [frontend/README.md](frontend/README.md)
- Extension package readme: [chrome-extension/README.md](chrome-extension/README.md)
- Project changelog/history: [CHANGELOG.md](CHANGELOG.md)
