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
JWT_SECRET=your_strong_secret_here
DB_USER=dev16
DB_HOST=/var/run/postgresql
DB_NAME=devwell_dev
DB_PORT=5432
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

## Privacy Model

- Camera processing is local on device.
- Backend receives only numeric session summaries.
- No video frames or face landmark arrays are uploaded.
- In Guest Mode, session data stays local in extension storage.

## Production Notes

- Set `NODE_ENV=production` where appropriate.
- Configure `EXTENSION_ID` in backend env to strictly allow your published extension origin.
- Keep local MediaPipe assets packaged:
  - Frontend: `frontend/public/mediapipe/`
  - Extension: `chrome-extension/lib/`

## Package Quick Links

- Frontend package readme: [frontend/README.md](frontend/README.md)
- Extension package readme: [chrome-extension/README.md](chrome-extension/README.md)
- Project changelog/history: [CHANGELOG.md](CHANGELOG.md)
