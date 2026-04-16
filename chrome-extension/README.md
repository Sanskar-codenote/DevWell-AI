# DevWell AI - Chrome Extension

Real-time developer wellness monitoring Chrome extension with AI-powered fatigue detection, session tracking, and analytics.

## 🌟 Features

- 🔐 **Authentication** - Securely syncs with your DevWell AI account.
- 👁️ **Blink Detection** - Uses MediaPipe AI to monitor your eye health in real-time.
- 🎯 **Popup-Only Camera** - Camera access runs entirely within the extension popup.
- 📊 **Quick Metrics** - View blinks, fatigue levels, and session duration at a glance.
- 🔔 **Smart Alerts** - Chrome notifications remind you to take breaks (20-20-20 rule).
- 💾 **Auto-Save** - Automatically persists session data to the backend database.

## 📁 Extension Structure

```
chrome-extension/
├── manifest.json          # Extension configuration (Manifest V3)
├── monitor.html           # Dedicated monitoring page (visible tab)
├── monitor.js             # AI logic and blink detection
├── popup.html             # Extension popup UI
├── popup.js               # Popup interaction logic
├── background.js          # Main controller (Service Worker)
├── content.js             # Website integration script
├── lib/                   # AI library and models (MediaPipe Tasks Vision)
└── icons/                 # Extension brand assets
```

## 🚀 Installation

1. Start your DevWell backend (`npm start` in the `backend` folder).
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-extension` folder.
5. Pin the extension to your toolbar for easy access.

## 📱 How to Use

1. Click the DevWell extension icon and **Login**.
2. Click **Start Session** in the popup.
3. Grant camera permissions when prompted.
4. Keep the popup open while monitoring (camera runs within popup).
5. As you work, the extension will count your blinks and calculate your fatigue score.
6. Click **End Session** in the popup to stop monitoring and save your data.

> **Note**: The camera session runs entirely within the extension popup. Do not close the popup during an active session.

## 🔧 Technical Details

### Architecture: Popup-Only Model
This extension runs the MediaPipe AI model and camera access entirely within the extension popup. This design:
- Eliminates the need for separate monitor tabs
- Provides a cleaner user experience
- Keeps all camera processing contained within the popup context
- Uses localStorage to sync state between popup and website

### Data Flow
```
User Action → Popup (UI + AI Engine) → Backend API
                  ↓
            localStorage Sync
                  ↓
            Website (Read-only display)
```

## 🛡️ Privacy & Security
- **Local Processing**: All AI landmark detection happens entirely on your machine.
- **No Video Storage**: We never record, upload, or save your camera feed.
- **Minimal Data**: Only numeric wellness metrics (blink rate, session length) are sent to the database.

---

**Built for developer wellness. Remember to blink! 👁️💙**
