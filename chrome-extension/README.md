# DevWell Browser Extension

A Manifest V3 browser extension that provides real-time developer wellness monitoring.

## Features
- **Independent Monitoring**: Camera processing runs in a dedicated pinned tab, ensuring it continues even when you switch tabs.
- **Dynamic Popup**: Quick access to session status, fatigue metrics, and recent alerts.
- **Guest Mode**: Local-only monitoring that doesn't require an account.
- **Seamless Sync**: Synchronizes authentication and session state with the DevWell dashboard.
- **Robust Lifecycle**: Automatically handles browser restarts and session cleanup.

## Setup & Installation

1.  **Configure environment**:
    Create a `.env` file in the `chrome-extension/` directory:
    ```env
    APP_BASE_URL=http://localhost:5173
    API_BASE_URL=http://localhost:3001
    ```

2.  **Install & Build**:
    ```bash
    npm install
    
    # Build for all supported browsers
    npm run build:all
    ```
    This generates two output directories: `dist/` (for Chromium browsers) and `dist-firefox/` (for Firefox).

3.  **Load into Browser**:
    - **Chrome / Edge / Brave**:
      - Open `chrome://extensions`.
      - Enable **Developer mode**.
      - Click **Load unpacked**.
      - Select the **`chrome-extension/dist/`** folder.
    - **Firefox**:
      - Open `about:debugging`.
      - Click **This Firefox**.
      - Click **Load Temporary Add-on...**.
      - Select the **`manifest.json`** inside **`chrome-extension/dist-firefox/`**.

4.  **Usage**:
    - Pin the extension for easy access.
    - Click the icon to log in or enter Guest Mode.
    - Start a session to begin monitoring.

## Technical Architecture
- **`background.js`**: Manages the core session state and lifecycle.
- **`monitor.js`**: Handles camera access and MediaPipe-based blink detection.
- **`content.js`**: Bridges state between the extension and the web application.
- **`popup.js`**: Powers the extension's user interface.

## Documentation
Refer to the main `README.md` in the project root for comprehensive extension architecture details.
