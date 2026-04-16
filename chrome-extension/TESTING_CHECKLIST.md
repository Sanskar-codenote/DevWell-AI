# Testing Checklist - DevWell Chrome Extension

## Pre-Testing Verification

### ✅ File Structure Check
```bash
cd chrome-extension
ls -1 monitor.html monitor.js background.js popup.html popup.js content.js manifest.json
```

**Expected files:**
- background.js
- monitor.html
- monitor.js
- popup.html
- popup.js
- content.js
- manifest.json

### ✅ Library Files Check
```bash
ls -lh lib/
```

**Expected files:**
- vision_bundle.js
- face_landmarker.task
- wasm/vision_wasm_internal.js
- wasm/vision_wasm_internal.wasm

---

## Testing Steps

### Step 1: Load Extension
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode".
3. Click "Load unpacked" and select the `chrome-extension` folder.
4. **Expected:** Extension loads without errors.

### Step 2: Login
1. Click extension icon.
2. Enter `demo@devwell.ai` / `demo123`.
3. Click **Login**.
4. **Expected:** Login is successful and "Start Session" button appears.

### Step 3: Start Session
1. Click **Start Session**.
2. **Expected:** A pinned tab "DevWell Monitor" opens immediately.
3. **Expected:** Browser asks for camera permission (first time only).
4. **Expected:** Camera preview appears in the Monitor tab.

### Step 4: Verify Blink Detection
1. Look at the camera in the Monitor tab and blink naturally.
2. Open the extension popup or look at the widget on the website.
3. **Expected:** "Total Blinks" increases in real-time.
4. **Expected:** Session time counts up every second.

### Step 5: Test Background Persistence
1. Minimize the Monitor tab or switch to other tabs/windows.
2. Wait for 60+ seconds.
3. Check the popup metrics.
4. **Expected:** Monitoring is still active and time has increased beyond 1 minute.

### Step 6: End Session
1. Click **End Session** in the popup.
2. **Expected:** The Monitor tab closes automatically.
3. **Expected:** A summary modal appears (if implement in UI).
4. **Expected:** Check backend console (`localhost:3001`) for a successful POST request to `/api/v1/sessions`.

---

## Success Criteria
✅ **All tests pass if:**
- Monitor tab opens/closes correctly.
- No 30-second background timeouts occur.
- Blinks are registered accurately.
- Session data saves to the database on end.
- No red error messages in any console.
