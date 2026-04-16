# DevWell AI

Real-time developer wellness monitoring app with webcam-based fatigue detection, session tracking, and analytics.

> **Privacy-First**: All facial processing happens client-side. No video, images, or facial landmarks are ever sent to the server.

## 🌟 Features

- 🔐 **JWT Authentication** - Secure user registration and login
- 👁️ **Real-Time Fatigue Detection** - MediaPipe FaceMesh tracks eye aspects ratio (EAR) for blink detection
- ⏱️ **Session Management** - Track work sessions with automatic persistence and recovery
- 📊 **Analytics Dashboard** - Weekly and monthly fatigue trends with burnout risk assessment
- 🔔 **Smart Alerts** - Notifications for moderate/high fatigue with sound alerts
- 💾 **Session Recovery** - Auto-saves every 5 seconds, restores on browser refresh/crash
- 🎨 **Modern UI** - Dark theme with Tailwind CSS v4

## 📁 Project Structure

```
DevWell/
├── frontend/                 # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── ProtectedLayout.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── context/         # React Context providers
│   │   │   ├── AuthContext.tsx      # Authentication state
│   │   │   └── SessionContext.tsx   # Session management
│   │   ├── lib/
│   │   │   ├── api.ts               # Axios API client
│   │   │   └── fatigueEngine.ts     # Core fatigue detection engine
│   │   ├── pages/
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── LoginPage.tsx
│   │   │   └── RegisterPage.tsx
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── backend/                 # Express + PostgreSQL API
│   ├── routes/
│   │   ├── auth.js          # Registration and login
│   │   ├── sessions.js      # Session CRUD operations
│   │   └── analytics.js     # Weekly/monthly analytics
│   ├── middleware/
│   │   └── auth.js          # JWT authentication middleware
│   ├── db.js                # Database initialization and pool
│   ├── server.js            # Express app entry point
│   ├── seed.js              # Demo data seeder
│   └── package.json
├── prd.md                   # Product requirements document
└── README.md
```

## 🛠️ Tech Stack

### Frontend

- **React 19** - UI library with hooks
- **TypeScript** - Type-safe development
- **Vite 7** - Fast build tool and dev server
- **Tailwind CSS v4** - Utility-first CSS framework
- **React Router 7** - Client-side routing
- **Axios** - HTTP client for API calls
- **Recharts 3** - Charting library for analytics
- **Lucide React** - Icon library
- **MediaPipe FaceMesh** - Client-side facial landmark detection

### Backend

- **Node.js + Express 5** - REST API framework
- **PostgreSQL (pg)** - Relational database
- **JWT (jsonwebtoken)** - Token-based authentication
- **bcryptjs** - Password hashing
- **CORS** - Cross-origin resource sharing
- **express-rate-limit** - API rate limiting
- **dotenv** - Environment variable management

## 🔄 Application Flow

### User Journey

1. **Authentication** - User registers or logs in with email/password
2. **Token Storage** - JWT token stored in `localStorage` as `devwell_token`
3. **Start Session** - User clicks "Start Session" on Dashboard
4. **Camera Activation** - Browser requests camera permission
5. **FaceMesh Initialization** - MediaPipe loads and begins facial landmark detection
6. **Real-Time Monitoring**:
   - Eye landmarks extracted and EAR (Eye Aspect Ratio) calculated
   - Blink events detected and counted
   - Long closure events (drowsiness) tracked
   - Fatigue score computed continuously
7. **Live Dashboard** - Metrics updated in real-time
8. **Persistent Session** - Session continues across route changes (Dashboard → Analytics)
9. **End Session** - Summary posted to backend (`POST /api/v1/sessions`)
10. **Analytics** - Weekly/monthly aggregates loaded from backend

### Fatigue Detection Algorithm

The `FatigueEngine` class (`frontend/src/lib/fatigueEngine.ts`) implements:

1. **EAR Calculation** - Eye Aspect Ratio from 6 landmarks per eye
   - Left eye: `[362, 385, 387, 263, 373, 380]`
   - Right eye: `[33, 160, 158, 133, 153, 144]`
   
2. **Adaptive Thresholding** - Calibrates to user's eye geometry
   - 5-second initial calibration period
   - Continuous adaptation to lighting/angle changes
   - Threshold range: 0.16 - 0.30

3. **Blink Detection** - Classifies eye closures by duration:
   - **Blink**: 50ms - 1500ms closure
   - **Drowsy Event**: >1500ms closure
   - Refractory period: 80ms between blinks
   - Reopen stability: 90ms to filter noise

4. **Fatigue Score (0-100)** - Three-component penalty system:
   - **Blink Deficit** (0-35 pts): Low blink rate vs threshold (<8/min)
   - **Closure Penalty** (0-36 pts): Long closure events (12 pts each)
   - **Duration Penalty** (0-40 pts): Gradual increase after 3 min grace period

5. **Fatigue Levels**:
   - `Fresh`: 0-40
   - `Moderate Fatigue`: 41-70
   - `High Fatigue`: 71-100

## 📱 Pages and Features

### 🏠 Dashboard Tab

#### Session Controls

- **Start Session**: Initializes webcam + FaceMesh detection engine
- **End Session**: Stops detection, generates summary, saves to backend

#### Camera Feed

- Live webcam preview (mirrored)
- `LIVE` indicator with pulse animation when active
- `Eye Status` badge shows `Open`/`Closed` based on EAR thresholding

#### Real-Time Metrics

| Metric | Description |
|--------|-------------|  
| **Session Time** | Elapsed duration (MM:SS format) |
| **Current Blink Rate (60s)** | Blinks in the most recent 60-second window |
| **Session Avg Rate** | `total_blinks / session_minutes` (smoothed in first minute) |
| **Total Blinks** | Cumulative blink count in current session |
| **Drowsy Events** | Count of long eye-closure events (>1.5s) |
| **Fatigue Score** | 0-100 score with circular progress indicator |
| **Fatigue Level** | Badge: `Fresh`, `Moderate Fatigue`, or `High Fatigue` |

#### Alerts & Notifications

- **In-App Alerts**: Toast notifications for fatigue detection
- **Browser Notifications**: System-level notifications (if permitted)
- **Sound Alert**: Audio warning on `High Fatigue` detection
- **Throttling**: Fatigue alerts limited to once per **1 hour**
- **Break Reminders**: 20-20-20 rule reminder every 20 minutes

#### Session Persistence & Recovery

**Persistent Video Architecture:**

The app uses a persistent hidden video element in the SessionContext that survives route changes:

- ✅ **Route Change Resilience**: Session continues when navigating between Dashboard and Analytics
- ✅ **Stream Sharing**: The hidden video element processes frames; dashboard preview syncs to it
- ✅ **No Interruption**: Blink counting and fatigue detection continue across all tabs

**Recovery Scenarios:**

| Scenario | Behavior |
|----------|----------|
| **Browser Refresh (F5)** | Session cleaned up, user prompted to start new session |
| **Navigation to Analytics** | Session continues running in background |
| **Return to Dashboard** | Preview syncs back to persistent stream |
| **Browser Crash** | Session data cleared on next load |

**Restoration Process on Page Reload:**
1. On page load, checks for `devwell_active_session` flag
2. Detects orphaned session from page reload
3. Cleans up any leftover MediaStream tracks (turns off camera)
4. Shows "Previous session was interrupted. Please start a new session." message
5. Clears orphaned session data from localStorage
6. User can start a fresh session

**Why Auto-Restart Is Not Possible:**
- Browser security policies require user interaction to start webcam
- FatigueEngine instance is lost on page reload
- MediaStream cannot be re-created without explicit user action

**Security - Cross-User Data Protection:**

Session data is automatically cleared to prevent data leakage between users:

- ✅ **On Logout**: All session data cleared from sessionStorage
- ✅ **On Login**: Stale session data from previous user cleared
- ✅ **On Registration**: Fresh start with no session data
- ✅ **On Token Expiry**: Invalid sessions cleared automatically

This ensures users never see another user's session metrics.

### 📈 Analytics Tab

Data loaded from backend endpoints:

- `GET /api/v1/analytics/weekly` - Current week metrics
- `GET /api/v1/analytics/monthly` - Last 4 weeks trend
- `GET /api/v1/sessions?limit=50` - Session history

#### Weekly View

Displays:

- **Average Fatigue Score** - Mean score for the week
- **Fatigue Change** - Comparison vs previous week (↑/↓)
- **Average Blink Rate** - Weekly average blinks per minute
- **Longest Session** - Maximum session duration
- **Daily Charts**:
  - Fatigue score line chart
  - Blink rate line chart

#### Monthly View

Displays:

- **Weekly Trend** - Last 4 weeks fatigue progression
- **High Fatigue Days** - Count of days with score > 70
- **Burnout Risk** - Calculated as `LOW`/`MEDIUM`/`HIGH` based on:
  - Consecutive weekly fatigue increases (3+ weeks = HIGH)
  - Average session duration (>240 min = HIGH)
  - Break frequency below threshold
- **Daily Breakdown** - Calendar view of daily metrics

#### Session History Table

Shows recent sessions with:

- Date
- Duration
- Average blink rate
- Fatigue score
- Long closure events

## 🔌 API Reference

Base path: `/api/v1`

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/auth/register` | Create new user account | No |
| `POST` | `/auth/login` | Authenticate and get JWT token | No |
| `GET` | `/auth/me` | Get current user profile | Yes |

### Session Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/sessions` | Save session summary | Yes |
| `GET` | `/sessions` | Get user session history | Yes |

**Query Parameters for `GET /sessions`:**
- `limit` (optional): Number of sessions to return (default: 50)

### Analytics Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/analytics/weekly` | Current week aggregates | Yes |
| `GET` | `/analytics/monthly` | Last 4 weeks trend | Yes |

### Health Check

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/health` | API status check | No |

### Authentication

All protected endpoints require a JWT token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

### Example: Save Session

**Request:**
```json
POST /api/v1/sessions
{
  "session_date": "2024-04-07",
  "duration_minutes": 45.5,
  "avg_blink_rate": 12.3,
  "fatigue_score": 35,
  "long_closure_events": 2
}
```

**Response:**
```json
{
  "id": 123,
  "session_date": "2024-04-07",
  "duration_minutes": 45.5,
  "avg_blink_rate": 12.3,
  "fatigue_score": 35,
  "long_closure_events": 2,
  "created_at": "2024-04-07T10:30:00.000Z"
}
```

## 🗄️ Database Schema

Tables are automatically created on backend startup via `initDB()` in `db.js`.

### Users Table

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  encrypted_password VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

| Column | Type | Description |
|--------|------|-------------|  
| `id` | SERIAL | Auto-incrementing primary key |
| `email` | VARCHAR(255) | Unique user email |
| `encrypted_password` | VARCHAR(255) | Bcrypt-hashed password |
| `created_at` | TIMESTAMPTZ | Account creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Sessions Table

```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  duration_minutes REAL NOT NULL,
  avg_blink_rate REAL NOT NULL,
  fatigue_score REAL NOT NULL,
  long_closure_events INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_date ON sessions(session_date);
```

| Column | Type | Description |
|--------|------|-------------|  
| `id` | SERIAL | Auto-incrementing primary key |
| `user_id` | INTEGER | Foreign key to users table |
| `session_date` | DATE | Date of the session |
| `duration_minutes` | REAL | Session length in minutes |
| `avg_blink_rate` | REAL | Average blinks per minute |
| `fatigue_score` | REAL | Final fatigue score (0-100) |
| `long_closure_events` | INTEGER | Count of drowsy events |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Indexes:**
- `idx_sessions_user_id` - Optimizes user-specific session queries
- `idx_sessions_date` - Optimizes date-range analytics queries

## ⚙️ Environment and Prerequisites

### Required Software

- **Node.js** 18 or higher
- **npm** (comes with Node.js)
- **PostgreSQL** 12 or higher

### Environment Variables

Backend uses these environment variables (with defaults in `backend/db.js`):

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET` | - | **Yes** | Secret key for JWT token signing |
| `DB_USER` | `dev16` | No | PostgreSQL username |
| `DB_HOST` | `/var/run/postgresql` | No | PostgreSQL host path |
| `DB_NAME` | `devwell_dev` | No | Database name |
| `DB_PORT` | `5432` | No | PostgreSQL port |
| `PORT` | `3001` | No | Backend server port |
| `NODE_ENV` | `development` | No | Environment mode |

### Setup `.env` File

Create `backend/.env` with your configuration:

```env
# Required
JWT_SECRET=your_super_secret_key_change_this

# Database (optional - defaults shown)
DB_USER=dev16
DB_HOST=/var/run/postgresql
DB_NAME=devwell_dev
DB_PORT=5432

# Server (optional)
PORT=3001
```

> **⚠️ Security Note**: Never commit `.env` files to version control. The `JWT_SECRET` should be a strong, random string in production.

## 🚀 Quick Start Guide

### Step 1: Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Step 2: Configure Environment

```bash
cd backend
# Create .env file (see Environment section above)
nano .env  # or use your preferred editor
```

### Step 3: Start Backend Server

```bash
cd backend
npm start
```

**Expected Output:**
```
Database tables initialized
DevWell API running on http://localhost:3001
```

The backend will:
- Connect to PostgreSQL
- Create database tables if they don't exist
- Start listening on port 3001

### Step 4: Start Frontend Dev Server

Open a new terminal:

```bash
cd frontend
npm run dev
```

**Expected Output:**
```
VITE v7.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

The frontend will:
- Start Vite dev server on port 5173
- Automatically proxy `/api` requests to `http://localhost:3001`
- Enable hot module replacement (HMR)

### Step 5: Access the Application

Open your browser and navigate to: **http://localhost:5173**

### Optional: Seed Demo Data

To quickly test the app with sample data:

```bash
cd backend
npm run seed
```

This creates a demo account:
- **Email**: `demo@devwell.ai`
- **Password**: `demo123`
- **Sessions**: 10 sample sessions with varying metrics

> **Note**: The seed script will not duplicate data if run multiple times.

## 📦 Build Commands

### Frontend Production Build

```bash
cd frontend
npm run build
```

This will:
- Compile TypeScript
- Bundle and minify JavaScript/CSS
- Optimize assets
- Output to `frontend/dist/`

### Preview Production Build

```bash
cd frontend
npm run preview
```

Serves the production build locally for testing.

### Linting

```bash
cd frontend
npm run lint
```

Runs ESLint to check for code quality issues.

## 🛠️ Development Tips

### Restart Backend

```bash
cd backend
npm start
```

> Note: For auto-restart on file changes, consider using `nodemon`:
> ```bash
> npm install -g nodemon
> nodemon server.js
> ```

### Restart Frontend

```bash
cd frontend
npm run dev
```

Vite supports hot module replacement (HMR), so most changes won't require a restart.

### Clear Browser Cache

If you experience issues with stale data:

1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

Or clear specific storage:

```javascript
// In browser console
localStorage.removeItem('devwell_token');
sessionStorage.clear();
```

### Debug Session Issues

If session data gets stuck:

1. Check browser console for errors
2. Verify sessionStorage:
   ```javascript
   // In browser console
   console.log(sessionStorage.getItem('devwell_active_session'));
   console.log(sessionStorage.getItem('devwell_session_data'));
   ```
3. Clear and restart:
   ```javascript
   sessionStorage.clear();
   location.reload();
   ```

### Debug Blink Detection

Enable verbose logging in the fatigue engine:

1. Open browser console (F12)
2. Start a session
3. Watch for logs:
   - `[EAR]` - Eye aspect ratio values
   - `[Eye]` - Eye open/close events
   - `[Blink]` - Blink detection and classification
   - `[Calibration]` - EAR threshold calibration
   - `[Session]` - Session save/restore events

### Database Management

**Connect to PostgreSQL:**
```bash
psql -U dev16 -d devwell_dev
```

**View recent sessions:**
```sql
SELECT * FROM sessions ORDER BY created_at DESC LIMIT 10;
```

**Clear all sessions:**
```sql
DELETE FROM sessions;
```

**View user accounts:**
```sql
SELECT id, email, created_at FROM users;
```

## 🔒 Privacy & Security

### Data Privacy

- **100% Client-Side Processing**: All facial recognition and fatigue detection happens in the browser
- **No Video Storage**: Video frames are never sent to the server or stored
- **No Landmark Storage**: Facial landmark coordinates are processed in real-time and discarded
- **Aggregated Data Only**: Only summary metrics (blink count, fatigue score) are sent to backend
- **User Consent**: Camera access requires explicit browser permission

### Security Features

- **JWT Authentication**: Secure token-based auth with bcrypt password hashing
- **CORS Protection**: Configured allowed origins for API access
- **Rate Limiting**: API endpoints protected against abuse (production mode)
- **Input Validation**: Backend validates all incoming data
- **SQL Injection Prevention**: Parameterized queries via `pg` library

## ⚠️ Known Limitations

- **Lighting Dependency**: Poor lighting may affect detection accuracy
- **Camera Quality**: Low-resolution webcams may reduce landmark precision
- **Browser Compatibility**: Requires modern browser with WebGL support
- **Single Face**: Only tracks one face at a time
- **Page Reload**: Session cannot auto-resume after page reload (browser security policy)
- **Single Tab Ownership**: Only one tab can own the session at a time

## 🐛 Troubleshooting

### Camera Not Working

1. Check browser permissions for camera access
2. Ensure no other app is using the camera
3. Try a different browser
4. Check console for MediaPipe errors

### FaceMesh Not Loading

1. Check internet connection (loads from CDN)
2. Clear browser cache
3. Check browser console for CDN errors
4. Try disabling ad blockers

### Session Not Restoring

This is expected behavior. When you reload the page:
- The session is intentionally cleaned up
- Camera is turned off to prevent orphaned streams
- You need to click "Start Session" again
- This is due to browser security policies requiring user interaction for camera access

### Camera Still On After Page Reload

If the camera light remains on after reloading:
1. This was a bug that has been fixed
2. The app now automatically cleans up orphaned streams on mount
3. If it still happens, check browser console for errors
4. Manually stop the camera in browser settings

### High Fatigue False Positives

1. Ensure good lighting
2. Position camera at eye level
3. Allow 5-second calibration period
4. Check EAR threshold in console logs

### API Connection Issues

1. Verify backend is running on port 3001
2. Check `backend/.env` configuration
3. Verify PostgreSQL is running
4. Check CORS settings in `server.js`

## 📝 License

This project is for educational and personal use.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📧 Support

For issues or questions:
- Check the troubleshooting section above
- Review browser console for error messages
- Verify all environment variables are set correctly

---

## 🏗️ Architecture Notes

### Persistent Video Element Pattern

The app implements a persistent video element pattern to maintain sessions across route changes:

```
SessionContext (Provider)
├── Hidden videoRef (persistent, off-screen)
│   ├── Used by FatigueEngine for processing
│   └── Survives route changes
│
└── DashboardPage
    └── Preview video element (visible)
        └── Syncs stream from videoRef when session active
```

**How It Works:**

1. **SessionContext** renders a hidden video element (positioned off-screen)
2. When session starts, FatigueEngine uses this persistent video for frame processing
3. **DashboardPage** has a visible preview video element
4. A `useEffect` in DashboardPage syncs the stream from hidden to visible video
5. When navigating to Analytics, Dashboard unmounts but hidden video continues
6. FatigueEngine keeps processing frames and counting blinks
7. When returning to Dashboard, preview syncs back to the stream

**Benefits:**
- ✅ Session continues across all routes
- ✅ No interruption in blink detection
- ✅ Camera doesn't restart on route change
- ✅ Single source of truth for video stream

### Session Lifecycle

```
Start Session
    ↓
Create MediaStream
    ↓
Assign to hidden videoRef
    ↓
FatigueEngine processes frames
    ↓
Sync stream to dashboard preview
    ↓
[User navigates to Analytics]
    ↓
Dashboard unmounts (preview lost)
    ↓
Hidden videoRef continues processing
    ↓
[User returns to Dashboard]
    ↓
Preview syncs to videoRef stream
    ↓
End Session
    ↓
Stop all tracks, clean up
```

### Page Reload Behavior

On page reload, the app:

1. **Detects orphaned session** in localStorage
2. **Cleans up MediaStream** tracks (turns off camera)
3. **Clears session data** to prevent stale state
4. **Shows info message** to user
5. **Requires manual restart** (browser security policy)

This prevents:
- Orphaned camera streams running in background
- UI state mismatch (camera on, but UI shows stopped)
- Attempting to use lost FatigueEngine instances

---

**Built with ❤️ for developer wellness**
