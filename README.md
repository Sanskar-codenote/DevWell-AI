# DevWell

> **Developer Wellness Platform** — Real-time fatigue monitoring and healthy break reminders

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18+-blue.svg)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-blue.svg)](https://www.postgresql.org/)

---

## ✨ Overview

DevWell is a **privacy-first developer wellness platform** that monitors eye blink behavior and fatigue levels in real-time, helping developers maintain healthy work habits. The system uses computer vision (MediaPipe) running locally to detect blinks and drowsiness, then provides actionable insights and break reminders without ever uploading your camera feed.

## 🚀 Key Features

- **Real-time Fatigue Detection**: Advanced local camera-based blink and drowsiness monitoring using MediaPipe Blendshapes, featuring momentum-based physiological smoothing and goal-oriented blink training.
- **Robust Background Tracking**: Specially optimized browser extension maintains high-fidelity blink tracking even when tabs are hidden or throttled.
- **Cross-Browser Support**: Production support for **Chromium-based browsers** (Chrome, Edge, Brave) and **Firefox** via dedicated extension builds.
- **Healthy Reminders**: Configurable alerts based on the 20-20-20 rule and advanced fatigue scoring (Fresh → Moderate → High).
- **Guest Mode**: Full local-only monitoring without requiring an account.
- **Dashboard & Analytics**: Track your weekly/monthly trends and session history via the web platform.

### Fatigue Score (Current Runtime)
- Score range: `0-100`, updated continuously during active sessions.
- Core components: PERCLOS sigmoid weight, blink deficit vs user goal, blink variability, long closures, duration accumulation, and micro-burst penalties.
- Confidence gating by attention state: `ATTENTIVE=1.0`, `LOOKING_DOWN=0.3`, `FACE_LOST=0.0`.
- Temporal smoothing: EMA-style adaptation (`0.05`) with recovery damping when alert conditions are sustained.
- Blink closure detection is adaptive (not a single fixed threshold): both-eye moderate closure or asymmetric strong+weak closure.

---

## 🛠️ Architecture Overview

The platform consists of three core components communicating securely:

1. **Web Application (React/TypeScript)**: The dashboard, analytics view, and settings interface.
2. **Browser Extension (Manifest V3)**: The background worker and camera monitor that tracks eye movement and syncs state to the dashboard.
3. **Backend API (Express/PostgreSQL)**: Secure JWT-based storage for long-term session metrics and analytics (only numeric data is uploaded, never images).

*For deep technical details, API references, and comprehensive Docker deployment instructions, please see the [DEVWELL_TECHNICAL_REPORT.md](./DEVWELL_TECHNICAL_REPORT.md).*

---

## 💻 Getting Started

### Prerequisites
- **Node.js** 18+
- **PostgreSQL** 16+

### 1. Clone & Install

```bash
git clone <repository-url>
cd DevWell

# Install dependencies for all workspaces
npm install -C backend
npm install -C frontend
npm install -C chrome-extension
```

### 2. Start the Backend

Create a `.env` file in the `backend/` directory:
```env
PORT=3001
FRONTEND_PORT=5173
JWT_SECRET=your_strong_secret_here
DB_USER=your_postgres_user
DB_HOST=localhost
DB_NAME=devwell_dev
DB_PORT=5432
```

Run the server:
```bash
cd backend
npm start
```

### 3. Start the Frontend Dashboard

```bash
cd frontend
npm run dev
```
Access the dashboard at `http://localhost:5173`.

### 4. Build and Load the Extension

The browser extension is required to track your eye movements across tabs. Create a `.env` file in the `chrome-extension/` directory:

```env
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:3001
```

Build the extension for all supported browsers:

```bash
cd chrome-extension
npm run build:all
```
This generates two output directories: `dist/` (for Chromium browsers) and `dist-firefox/` (for Firefox).

Browser notes:
- `MediaStreamTrackProcessor` and `ImageCapture` are used when available, with fallback paths for throttled/hidden-tab processing.
- Safari/iOS are not currently production targets for the extension-based tracking flow.

**To Load in Chrome / Edge / Brave:**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/dist/` folder.
5. **Pin** the extension to your toolbar.

**To Load in Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select any file inside the `chrome-extension/dist-firefox/` folder.

---

## 🔒 Privacy Guarantee

- ✅ **100% Local Processing**: No video frames ever leave your device.
- ✅ **No Biometric Data Stored**: We only transmit abstract numeric summaries (e.g. "Blinks per minute: 12") to the backend.
- ✅ **Guest Mode**: Run the extension entirely locally with zero network requests.

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

<p align="center">
  Made with ❤️ for Developer Wellness
</p>
