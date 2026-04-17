**Canonical docs:** See [docs/WEBSITE.md](docs/WEBSITE.md) and [docs/EXTENSION.md](docs/EXTENSION.md) for current behavior. This file is kept for historical/reference context.

# Changelog

All notable changes to the DevWell AI project.

## [2024-04-16] - Bug Fixes & Architecture Improvements

### 🐛 Bug Fixes

#### Fixed: Blink Detection Stops When Switching Browser Tabs
- **Issue**: When user switched to other browser tabs (Gmail, YouTube, etc.), blink detection stopped completely
- **Root Cause**: 
  - Extension was trying to run camera session in the popup
  - Popup closes when user clicks away to another tab
  - Video element destroyed, camera stream stops
  - Blink detection halts
- **Fix**:
  - Switched from "popup-only" to "dedicated monitor tab" architecture
  - Background.js opens pinned monitor.html tab when session starts
  - Monitor tab runs continuously in background
  - User can minimize monitor tab and switch to any other tab
  - Metrics broadcast via chrome.storage to popup and website
  - Session continues uninterrupted regardless of tab switching
- **Files Changed**:
  - `chrome-extension/popup.js` - Updated session action handler
  - `chrome-extension/README.md` - Updated architecture documentation
  - `README.md` - Updated feature description

#### Fixed: Website Background Tab Throttling
- **Issue**: When starting session from website and switching to other browser tabs, blink detection stopped or became unreliable
- **Root Cause**: Browsers throttle `requestAnimationFrame` in background tabs to save CPU/battery
- **Fix**:
  - Added Page Visibility API detection to track when tab is hidden/visible
  - Implemented dual-mode processing:
    - **Visible tab**: Uses `requestAnimationFrame` for smooth 30 FPS processing
    - **Hidden tab**: Falls back to `setTimeout` with 500ms interval (2 FPS)
  - Session continues running in background at reduced frame rate
  - Automatically switches back to normal mode when tab becomes visible
  - Added proper cleanup for both animation frame and setTimeout timers
- **Files Changed**:
  - `frontend/src/lib/fatigueEngine.ts` - Added visibility tracking and background mode
  - `frontend/src/pages/DashboardPage.tsx` - Removed background tab warning
  - `README.md` - Removed background tab limitation from known issues

#### Fixed: Website and Extension Start Button Conflicts
- **Issue**: When both website and Chrome extension were running in same browser, both could try to start/stop sessions simultaneously, causing conflicts
- **Root Cause**: 
  - Website didn't disable session controls when extension was active
  - Both website and extension could send start/stop commands
  - No visual indication to user which system was controlling the session
- **Fix**:
  - Added `extensionAvailable` to SessionContext interface and provider
  - DashboardPage now detects when extension is active
  - Session control buttons replaced with "Extension Active" badge when extension detected
  - Added informative banner explaining to use extension popup for control
  - Website becomes read-only display for extension-controlled sessions
- **Files Changed**:
  - `frontend/src/context/SessionContext.tsx`
  - `frontend/src/pages/DashboardPage.tsx`
  - `README.md`

#### Fixed: White Screen on Website Load
- **Issue**: Website showing blank white screen on initial load
- **Root Cause**: 
  - Unsafe `localStorage` access at module level in AuthContext
  - TypeScript compilation errors preventing build
  - `FaceLandmarkerResult` imported as value instead of type
  - Session restoration calling `startSession()` without required video element
- **Fix**:
  - Wrapped localStorage access in try-catch inside useState initializer
  - Changed `FaceLandmarkerResult` to type-only import (`type FaceLandmarkerResult`)
  - Removed automatic session restoration that tried to start without video element
  - Updated session restoration to show user message instead of auto-starting
- **Files Changed**:
  - `frontend/src/context/AuthContext.tsx`
  - `frontend/src/lib/fatigueEngine.ts`
  - `frontend/src/context/SessionContext.tsx`

#### Fixed: Camera Stops When Navigating to Analytics Tab
- **Issue**: Camera preview stops and blink counting halts when navigating from Dashboard to Analytics
- **Root Cause**: FatigueEngine was using video element from DashboardPage component, which gets unmounted on route change
- **Fix**:
  - Leveraged existing persistent hidden video element in SessionContext
  - FatigueEngine now uses persistent `videoRef` that survives route changes
  - DashboardPage preview syncs stream from hidden video element
  - Session continues running across all routes
- **Files Changed**:
  - `frontend/src/context/SessionContext.tsx`
  - `frontend/src/pages/DashboardPage.tsx`

#### Fixed: Camera Remains Active After Page Reload
- **Issue**: After page reload, camera stays on but UI shows "Start Session" button and blink counting stops
- **Root Cause**: 
  - React state resets on reload
  - FatigueEngine instance lost
  - MediaStream becomes orphaned (still running but not tracked)
  - No cleanup of orphaned streams
- **Fix**:
  - Added orphaned stream cleanup effect on mount
  - Detects and stops leftover MediaStream tracks
  - Clears orphaned session data from localStorage
  - Shows user-friendly message explaining session was interrupted
  - Requires manual session restart (browser security policy)
- **Files Changed**:
  - `frontend/src/context/SessionContext.tsx`

### 🏗️ Architecture Changes

#### Persistent Video Element Pattern
- Implemented persistent video element architecture for route change resilience
- Hidden video element in SessionContext survives component unmounts
- Stream sharing between hidden processing video and visible preview
- Single source of truth for MediaPipe frame processing

#### Session Lifecycle Management
- Improved session state management across route changes
- Proper cleanup of orphaned sessions on page reload
- Clear separation between session ownership and preview display
- Enhanced user feedback for session interruptions

### 📝 Documentation Updates

- Updated `README.md` with:
  - Persistent video architecture explanation
  - Session lifecycle diagrams
  - Page reload behavior documentation
  - Updated troubleshooting section
  - Architecture notes section

- Updated `frontend/README.md` with:
  - Project-specific documentation (replaced default Vite template)
  - Architecture overview
  - Development guidelines
  - Debugging tips

- Updated `chrome-extension/README.md` with:
  - Popup-only camera access model
  - Updated data flow diagrams
  - Removed outdated monitor tab references

### 🔧 Technical Improvements

- Fixed TypeScript compilation errors
- Improved type safety with verbatim module syntax
- Enhanced error handling for localStorage access
- Better session state synchronization
- Cleaner separation of concerns between contexts

### ⚠️ Breaking Changes

- **Session Auto-Restart Removed**: Sessions no longer auto-resume after page reload due to browser security policies requiring user interaction for camera access
- **Manual Restart Required**: Users must click "Start Session" after page reload

### ✅ New Behaviors

- **Route Change Resilience**: Session continues when navigating between Dashboard and Analytics
- **Automatic Cleanup**: Orphaned camera streams automatically cleaned up on page load
- **Better User Feedback**: Clear messages explaining session state and required actions
- **Background Tab Support**: Website sessions now continue running when tab is hidden (at reduced 2 FPS)
- **Dual-Mode Processing**: Automatic switching between high-performance (visible) and background (hidden) modes

---

## Previous Versions

For earlier changes, please refer to git commit history.
