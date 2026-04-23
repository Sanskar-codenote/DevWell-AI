# DevWell

DevWell is a developer wellness platform with:
- A web app (`frontend`) for live monitoring and analytics.
- A backend API (`backend`) for auth, sessions, and analytics.
- A Chrome extension (`chrome-extension`) for dedicated pinned-tab monitoring.

## Canonical Documentation

Use these docs as the source of truth:
- Website and backend: [docs/WEBSITE.md](docs/WEBSITE.md)
- Chrome extension: [docs/EXTENSION.md](docs/EXTENSION.md)

Legacy markdown files in this repo are retained for history, migration notes, and earlier implementation context.

## Quick Start

### 1) Backend
```bash
cd backend
npm install
npm start
```

### 2) Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3) Extension (optional)
- Open `chrome://extensions`
- Enable Developer mode
- Load unpacked `chrome-extension/`

Default local URLs:
- Frontend: `http://localhost:5173` (or `5174`)
- Backend: `http://localhost:3001`

## Production Deployment

When deploying DevWell to a production environment, ensure the following configurations:

### 1. Environment Variables
- Set `NODE_ENV=production` for both backend and frontend builds.
- Configure `EXTENSION_ID` in the backend `.env` to match your published Chrome Extension ID to allow secure cross-origin communication.

### 2. MediaPipe Assets
- MediaPipe assets (WASM and model files) are hosted locally in this project to avoid external CDN dependencies and improve reliability.
- **Frontend**: Assets are located in `frontend/public/mediapipe/`.
- **Extension**: Assets are located in `chrome-extension/lib/`.

### 3. Database Management
- **Indexing**: Ensure the `sessions` table is indexed on `userId` and `startTime` for performant analytics queries.
- **Pool Management**: In production, configure the database connection pool (in `backend/db.js`) with appropriate `max` and `idleTimeoutMillis` values based on your server capacity.

