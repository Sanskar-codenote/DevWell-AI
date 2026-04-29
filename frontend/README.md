# DevWell Frontend

The web application for DevWell AI, built with React, TypeScript, and Vite.

## Features
- **Dashboard**: Real-time monitoring and session control.
- **Analytics**: Visualization of blink rates and fatigue trends.
- **Settings**: Configuration of fatigue thresholds and notifications.
- **Responsive Design**: Styled with Tailwind CSS for a seamless experience.
- **Extension Sync**: Automatic state synchronization with the DevWell Chrome Extension.

## Quick Start

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Start development server**:
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:5173`.

3.  **Build for production**:
    ```bash
    npm run build
    ```

## Development

- **API Proxy**: In development, requests to `/api` are proxied to `http://localhost:3001` (configurable in `vite.config.ts`).
- **MediaPipe Assets**: Local WASM and task files are stored in `public/mediapipe/` for reliable offline processing.

## Documentation
Refer to the main `README.md` in the project root for comprehensive architectural details.
