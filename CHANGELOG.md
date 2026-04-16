# Changelog

All notable changes to the DevWell AI project.

## [2024-04-16] - Bug Fixes & Architecture Improvements

### 🐛 Bug Fixes

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

---

## Previous Versions

For earlier changes, please refer to git commit history.
