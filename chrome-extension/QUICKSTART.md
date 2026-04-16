# 🚀 DevWell Chrome Extension - Quick Start

## What's New! ✨

The DevWell extension has been upgraded to a robust **Dedicated Tab Architecture** for 100% stability:

✅ **100% Stable Monitoring** - No more 30-second background timeouts.
✅ **GPU Acceleration** - Faster, smoother blink detection.
✅ **Visible Preview** - See exactly what the AI sees in a dedicated monitor tab.
✅ **Reliable Saving** - Sessions now save perfectly to the database on end.

## 📦 Installation (First Time Only)

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked**
4. Select: `/home/dev16/AI/codenote/DevWell/chrome-extension`
5. **Pin** the extension to toolbar (click 🧩 → pin icon)

## 🎯 How to Use (3 Simple Steps)

### Step 1: Login
1. Click DevWell extension icon.
2. Enter credentials:
   - **Email:** `demo@devwell.ai`
   - **Password:** `demo123`
3. Click **Login**.

### Step 2: Start Session
1. Click the blue **"Start Session"** button.
2. A new pinned tab titled **"DevWell Monitor"** will open.
3. **Allow camera access** in that tab when prompted.
4. You'll see your camera feed in the monitor tab. 
5. **Keep this tab open** (you can minimize it or switch to other tabs). Blink counting is now active! 👁️

### Step 3: End Session
1. Click the red **"End Session"** button in the popup (or just close the Monitor tab).
2. The session data is automatically calculated and saved to the database.
3. Check your updated stats in the DevWell web app dashboard.

## 👁️ How Blink Detection Works

1. **AI Powered:** Uses MediaPipe Tasks Vision to track 468 facial landmarks.
2. **Personalized:** Calibrates to your specific "open eye" state for the first 30 frames.
3. **Smart Metrics:**
   - **EAR:** Calculates Eye Aspect Ratio to detect closures.
   - **Blink:** Fast closure (50ms - 1500ms).
   - **Drowsy:** Long closure (>1500ms).

## 🔧 Troubleshooting

**Monitor tab didn't open?**
- Make sure you are logged in.
- Check if you already have a pinned "DevWell Monitor" tab.

**Camera not showing?**
- Ensure no other app (like Zoom or Teams) is using your camera.
- Refresh the "DevWell Monitor" tab.

**Blinks not counting?**
- Make sure your face is clearly visible in the Monitor tab.
- Ensure good lighting (no heavy shadows on eyes).

---

**Happy coding! Remember to blink! 👁️💙**
