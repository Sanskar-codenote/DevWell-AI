# DevWell AI Chrome Extension - Quick Installation Guide

## 🚀 Install in 3 Steps

### Step 1: Start DevWell Backend
```bash
cd /home/dev16/AI/codenote/DevWell/backend
npm start
```

### Step 2: Load Extension in Chrome

1. Open Chrome and go to: `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder: `/home/dev16/AI/codenote/DevWell/chrome-extension`
5. ✅ Done! The extension is now installed

### Step 3: Pin to Toolbar (Optional)

1. Click the puzzle piece icon 🧩 in Chrome's toolbar
2. Find "DevWell AI - Developer Wellness Monitor"
3. Click the pin icon 📌

## 📱 Using the Extension

### Quick Start
1. Click the DevWell icon in your toolbar.
2. Click **Start Session**.
3. A pinned **Monitor Tab** will open. Allow camera access there.
4. The extension badge will start showing your session duration.
5. Work normally - fatigue is monitored automatically! You can minimize the monitor tab.

### What You'll See

**Extension Badge:**
- Shows session duration (e.g., "25m" or "2h")
- Color changes based on fatigue:
  - 🟢 Green = Fresh (0-40)
  - 🟡 Yellow = Moderate Fatigue (41-70)
  - 🔴 Red = High Fatigue (71-100)

**Popup Metrics:**
- Session Time
- Blink Rate
- Total Blinks
- Drowsy Events
- Fatigue Score (0-100)
- Fatigue Level

**Chrome Notifications:**
- Moderate fatigue alerts
- High fatigue warnings
- Break reminders (every 20 minutes)

**Floating Widget:**
- Appears on DevWell dashboard
- Shows live metrics
- Draggable to any position

## 🔧 Troubleshooting

**Extension not showing?**
- Reload: `chrome://extensions/` → Click reload icon
- Check: All files are in the `chrome-extension` folder

**Notifications not working?**
- Chrome Settings → Privacy → Site Settings → Notifications
- Allow notifications for the extension

**Session not saving?**
- Make sure you're logged into DevWell web app
- Check backend is running on port 3001

## 📞 Need Help?

1. Check the full README.md in this folder
2. Open Chrome DevTools on the extension popup (right-click → Inspect)
3. Check the background script logs (chrome://extensions/ → service worker)

---

**Enjoy healthier coding sessions! 💪👨‍💻**
