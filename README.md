# DevWell

> **Developer Wellness Platform** — Real-time fatigue monitoring and healthy break reminders

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue.svg)](https://www.postgresql.org/)

---

## ✨ Overview

DevWell is a **privacy-first developer wellness platform** that monitors eye blink behavior and fatigue levels in real-time, helping developers maintain healthy work habits. The system uses computer vision (MediaPipe) to detect blinks and drowsiness, then provides actionable insights and break reminders.

### 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DevWell Platform                               │
├─────────────────┬─────────────────┬───────────────────────────────────┤
│  Chrome          │  Web Application │  Backend API                        │
│  Extension       │  (React/TS)      │  (Express + PostgreSQL)             │
│  ┌─────────────┐ │  ┌─────────────┐ │  ┌─────────────┐                    │
│  │ monitor.html │ │  │  Dashboard   │ │  │   Sessions   │                    │
│  │  (detection) │ │  │  Analytics   │ │  │   Analytics  │                    │
│  │  popup.html  │ │  │  Settings    │ │  │   Auth       │                    │
│  └─────────────┘ │  └─────────────┘ │  └─────────────┘                    │
│  background.js   │  vite + tailwind  │  zod + jwt + helmet                  │
└─────────────────┴─────────────────┴───────────────────────────────────┘
```

---

## 🚀 Features

### Core Capabilities
- **Real-time Fatigue Detection**: Camera-based blink monitoring using MediaPipe face landmarks
- **Blink Analysis**: Eye Aspect Ratio (EAR) calculation with configurable thresholds
- **Drowsiness Detection**: Long-eye-closure events (>1500ms) with fatigue scoring
- **Fatigue Classification**: Three-tier system (Fresh → Moderate Fatigue → High Fatigue)

### User Experience
- **20-20-20 Rule Reminders**: Configurable break notifications
- **Weekly/Monthly Analytics**: Trend visualization and session history
- **Browser Notifications**: Real-time alerts for fatigue thresholds
- **Guest Mode**: Local-only monitoring without account creation

### Browser Support
- **Google Chrome** (Manifest V3)
- **Mozilla Firefox** (Manifest V3 compatible, auto-polyfilled)

### Technical Features
- **Multi-tab Synchronization**: Single-owner model with follower tabs mirroring state
- **Robust Background Tab Support**: Continuous monitoring using `ImageCapture` API and `MediaStreamTrackProcessor`, specifically optimized to bypass browser throttling and maintain high-fidelity tracking even when tabs are hidden.
- **Sparse Frame Detection**: Advanced heuristics accurately classify blinks vs. drowsiness even when camera frames drop to 1-2 FPS.
- **Extension-Website Bridge**: Seamless state synchronization
- **Account Mismatch Protection**: Prevents conflicts between different user sessions

---

## 📁 Project Structure

```
devwell/
├── backend/                    # Express API server
│   ├── src/
│   │   ├── routes/             # API endpoints (auth, sessions, analytics)
│   │   ├── middleware/         # Auth, validation, error handling
│   │   └── db/                 # PostgreSQL models and migrations
│   ├── package.json
│   └── .env.example
│
├── frontend/                   # React + TypeScript web app
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Dashboard, Analytics, Settings
│   │   ├── lib/                # Fatigue engine, detection logic
│   │   └── hooks/              # Custom React hooks
│   ├── public/mediapipe/       # Local MediaPipe assets
│   └── vite.config.ts
│
├── chrome-extension/           # Manifest V3 Chrome extension
│   ├── src/
│   │   ├── background.js        # Session lifecycle management
│   │   ├── monitor.js           # Camera processing & detection
│   │   ├── popup/               # Extension UI
│   │   ├── content.js           # Website DOM bridge
│   │   └── options/             # Settings page
│   └── manifest.json
│
├── docker-compose.yml          # Production deployment
├── scripts/
│   └── backup-db.sh             # Automated database backups
---

## 🛠️ Technical Details

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

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | User registration |
| POST | `/api/v1/auth/login` | User login (JWT) |
| GET | `/api/v1/auth/me` | Get current user |
| POST | `/api/v1/sessions` | Create session |
| GET | `/api/v1/sessions` | List user sessions |
| GET | `/api/v1/analytics/weekly` | Weekly trend data |
| GET | `/api/v1/analytics/monthly` | Monthly trend data |

---

## 💻 Development

### Prerequisites
- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **PostgreSQL** 16+

---

### Local Setup

#### 1. Clone & Install

```bash
# Clone the repository
git clone <repository-url>
cd DevWell

# Install all dependencies
npm install -C backend
npm install -C frontend
npm install -C chrome-extension
```

#### 2. Configure Backend

Create `backend/.env`:

```env
PORT=3001
FRONTEND_PORT=5173
JWT_SECRET=your_strong_secret_here
DB_USER=dev16
DB_HOST=/var/run/postgresql
DB_NAME=devwell_dev
DB_PORT=5432
# DB_PASSWORD=postgres           # Optional for Unix socket auth
# EXTENSION_ID=your_id          # Optional for local CORS lock
```

#### 3. Start Backend

```bash
cd backend
npm start
# Optional: Seed demo data
npm run seed
```

#### 4. Start Frontend

```bash
cd frontend
npm run dev
```

Access at: `http://localhost:5173`

#### 5. Load Extension (Chrome & Firefox)

Create `chrome-extension/.env`:

```env
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3001
```

Build for all supported browsers:

```bash
cd chrome-extension
npm run build:all
```
This generates two output directories: `dist/` (for Chrome) and `dist-firefox/` (for Firefox).

**In Chrome:**
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `chrome-extension/dist/`
5. **Pin** the extension

**In Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select any file inside `chrome-extension/dist-firefox/`

---

## 🐳 Docker Deployment

### Quick Start

```bash
# Copy and configure environment
cp .env.docker.example .env
# Edit .env with your values

# Build and start all services
docker compose up -d --build

# Verify health status
docker compose ps
curl http://localhost:3001/api/health
```

Access:
- **Frontend**: `http://localhost:80` (or your `FRONTEND_PORT`)
- **Backend**: `http://localhost:3001` (or your `BACKEND_PORT`)

---

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

---

### Production Checklist

- [ ] Strong `JWT_SECRET` generated (`openssl rand -base64 64`)
- [ ] Strong `DB_PASSWORD` set
- [ ] `CORS_ALLOWED_ORIGINS` configured for production domains
- [ ] `EXTENSION_ID` set to published Chrome extension ID
- [ ] TLS/HTTPS configured via reverse proxy
- [ ] Database backup cron job configured
- [ ] `LOG_LEVEL` set appropriately (`info` for production, `debug` for staging)
- [ ] MediaPipe assets present in `frontend/public/mediapipe/` and `chrome-extension/lib/`

---

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

---

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

---

### TLS/HTTPS

The Docker stack serves HTTP. For production HTTPS, use a reverse proxy:

```bash
# Caddy (recommended - automatic HTTPS)
caddy reverse-proxy --from yourdomain.com --to localhost:80

# Or configure Traefik/Nginx with Let's Encrypt
```

---

### Common Commands

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

## 🔒 Privacy & Security

### Privacy Model
- ✅ **Camera processing is 100% local** — No video frames leave your device
- ✅ **No face landmark arrays uploaded** — Only numeric session summaries sent to backend
- ✅ **Guest Mode is fully local** — Session data stays in extension storage
- ✅ **No third-party tracking** — Analytics are user-only

### Backend receives only:
```typescript
{
  user_id: string;
  session_date: Date;
  duration_minutes: number;
  avg_blink_rate: number;
  fatigue_score: number;
  long_closure_events: number;
}
```

### Security Features
- JWT-based authentication with strong secrets
- CORS restricted to configured origins
- Rate limiting on all API endpoints
- Helmet security headers
- PostgreSQL connection pooling with limits
- Environment variable validation on startup

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

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [MediaPipe](https://mediapipe.dev/) — Cross-platform ML for face detection
- [React](https://react.dev/) — Frontend framework
- [Express.js](https://expressjs.com/) — Backend framework
- [PostgreSQL](https://www.postgresql.org/) — Relational database

---

## 📞 Support

- **Help**: Check the component READMEs for specific setup guides
- **Issues**: Open a GitHub issue
- **Questions**: Start a discussion in the repository

---

<p align="right">
  Made with ❤️ for Developer Wellness
</p>
