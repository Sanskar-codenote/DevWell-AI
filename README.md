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
