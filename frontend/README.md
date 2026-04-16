# DevWell AI - Frontend

React + TypeScript + Vite frontend for the Developer Wellness Monitor application.

## 📁 Structure

```
src/
├── components/          # Reusable UI components
│   ├── ErrorBoundary.tsx      # Error boundary for graceful error handling
│   ├── ProtectedLayout.tsx    # Protected route wrapper with sidebar
│   └── Sidebar.tsx            # Navigation sidebar
├── context/             # React Context providers
│   ├── AuthContext.tsx          # Authentication state management
│   └── SessionContext.tsx       # Session management with persistent video
├── lib/
│   ├── api.ts                   # Axios API client with interceptors
│   ├── extensionSync.ts         # Chrome extension synchronization
│   └── fatigueEngine.ts         # Core fatigue detection engine (MediaPipe)
├── pages/
│   ├── AnalyticsPage.tsx        # Analytics dashboard with charts
│   ├── DashboardPage.tsx        # Real-time monitoring dashboard
│   ├── LoginPage.tsx            # User login
│   └── RegisterPage.tsx         # User registration
├── App.tsx              # Main app component with routing
├── index.css            # Global styles (Tailwind)
└── main.tsx             # Entry point
```

## 🏗️ Architecture

### Persistent Video Element Pattern

The app uses a persistent video element to maintain sessions across route changes:

**SessionContext** renders a hidden video element (off-screen) that:
- Survives route changes (Dashboard ↔ Analytics)
- Is used by FatigueEngine for frame processing
- Shares MediaStream with dashboard preview

**DashboardPage** has a visible preview video that:
- Syncs stream from hidden video when session is active
- Unmounts on navigation without stopping the session
- Re-syncs when user returns to dashboard

### State Management

- **AuthContext**: Manages user authentication, JWT token, and login/logout
- **SessionContext**: Manages fatigue session, video streams, and alerts
- Both contexts use React hooks and localStorage for persistence

### Key Features

- ✅ Route change resilience (session continues across tabs)
- ✅ Automatic orphaned stream cleanup on page reload
- ✅ Real-time fatigue detection with MediaPipe FaceMesh
- ✅ Smart alert system with sound and browser notifications
- ✅ Analytics with Recharts visualization

## 🛠️ Tech Stack

- **React 19** with hooks
- **TypeScript** for type safety
- **Vite 7** for fast builds
- **Tailwind CSS v4** for styling
- **React Router 7** for routing
- **Axios** for API calls
- **Recharts 3** for charts
- **MediaPipe Tasks Vision** for face tracking
- **Lucide React** for icons

## 🚀 Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```

## 🔧 Configuration

- **Vite**: Proxy `/api` requests to backend at `http://localhost:3001`
- **Tailwind**: Using v4 with `@tailwindcss/vite` plugin
- **TypeScript**: Strict mode with verbatim module syntax

## 📝 Important Notes

### Session Behavior

- **Route Changes**: Session continues running (Dashboard → Analytics → Dashboard)
- **Page Reload**: Session is cleaned up, user must restart (browser security)
- **Multiple Tabs**: Only one tab can own the session at a time
- **Camera Access**: Requires user interaction to start (cannot auto-start on load)

### MediaPipe Integration

- Models loaded from `/mediapipe/` directory
- Uses GPU delegate for performance
- Processes video frames in real-time using requestAnimationFrame
- Calculates Eye Aspect Ratio (EAR) for blink detection

### Error Handling

- ErrorBoundary catches and displays React errors
- API errors handled via Axios interceptors
- Graceful fallbacks for failed session operations
- User-friendly error messages throughout

## 🐛 Debugging

### Enable Verbose Logging

Open browser console (F12) to see:
- Session state changes
- API requests/responses
- MediaPipe initialization
- Fatigue engine events

### Common Issues

**Camera not starting:**
- Check browser permissions
- Ensure no other app is using camera
- Check console for MediaPipe errors

**Session not syncing:**
- Verify videoRef is properly passed to startSession
- Check useEffect dependencies in DashboardPage
- Look for console warnings about stream sync

**Build errors:**
- Run `npm run build` to check TypeScript errors
- Ensure all type imports use `type` keyword
- Check for missing dependencies

## 📦 Dependencies

### Runtime
- `@mediapipe/tasks-vision` - Face tracking
- `axios` - HTTP client
- `lucide-react` - Icons
- `react` + `react-dom` - UI library
- `react-router-dom` - Routing
- `recharts` - Charts

### Development
- `@tailwindcss/vite` - Tailwind integration
- `@vitejs/plugin-react` - React support
- `typescript` - Type checking
- `vite` - Build tool

---

Built with ❤️ for developer wellness
