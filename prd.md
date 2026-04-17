**Canonical docs:** See [docs/WEBSITE.md](docs/WEBSITE.md) and [docs/EXTENSION.md](docs/EXTENSION.md) for current behavior. This file is kept for historical/reference context.

# DevWell AI – Product Requirements Document (PRD)

## Version
v1.0 (MVP)

## Document Owner
Product / Engineering

## Last Updated
2026-02-27

---

# 1. Product Overview

**DevWell AI** is a privacy-first web application that monitors developer fatigue in real time using browser-based facial analysis and provides actionable wellness insights through weekly and monthly analytics.

The system processes facial data locally in the browser and stores only aggregated session metrics in the backend.

---

# 2. Problem Statement

Developers frequently experience:

- Digital eye strain
- Reduced blink rate during long coding sessions
- Extended continuous screen exposure
- Progressive burnout due to lack of structured breaks

Existing tools rely on timers or manual tracking and do not use physiological indicators to assess fatigue.

There is no lightweight, privacy-first web solution that combines:
- Real-time fatigue detection
- Long-term analytics
- Burnout trend insights

---

# 3. Product Goals

## Primary Goals

1. Detect developer fatigue in real time using webcam-based analysis.
2. Encourage healthy work habits via break reminders.
3. Provide weekly and monthly fatigue analytics.
4. Maintain strict privacy and zero biometric storage.

## Success Metrics

- Daily active session rate
- 7-day retention rate
- Average sessions per user per week
- Weekly analytics page visits
- Conversion rate to Pro (future)

---

# 4. Target Users

## Persona 1: Remote Developer
- Works 8–12 hours daily
- Frequently forgets breaks
- Values productivity and self-optimization

## Persona 2: Startup Engineer
- High workload environment
- Often works late nights
- Concerned about burnout

## Persona 3: CS Student
- Long study hours
- Exam preparation fatigue
- Wants structured break reminders

---

# 5. Scope

## In Scope (MVP)

- Webcam-based blink detection
- Real-time fatigue alerts
- Session tracking
- Backend session storage
- Weekly analytics
- Monthly analytics
- Burnout trend indicator

## Out of Scope (MVP)

- Storing video data
- Storing facial landmarks
- Machine learning model training
- Team dashboards
- Mobile app

---

# 6. Functional Requirements

---

## 6.1 Authentication (Backend - Rails)

### FR-1: User Registration
- Email + password signup
- Secure password hashing
- JWT-based authentication

### FR-2: Login
- Token-based authentication
- Session management

---

## 6.2 Real-Time Fatigue Monitoring (Frontend - React)

All facial analysis must occur client-side.

### FR-3: Webcam Activation
- User grants camera permission
- Webcam preview displayed
- Face detection initialized

### FR-4: Blink Detection
System shall:
- Detect facial landmarks using MediaPipe FaceMesh
- Calculate Eye Aspect Ratio (EAR)
- Track blink frequency per minute

Alert condition:
- Blink rate < 8 per minute

---

### FR-5: Eye Closure Detection
If eyes remain closed for > 1.5 seconds:
- Trigger drowsiness alert

---

### FR-6: Fatigue Score Calculation

Fatigue Score (0–100) based on:

- Blink deficit weight
- Long eye closure events
- Session duration

Display states:
- 0–40 → Fresh
- 41–70 → Moderate Fatigue
- 71–100 → High Fatigue

---

### FR-7: Break Notifications

System shall:
- Show in-app modal
- Trigger browser notification
- Suggest 20-20-20 rule reminder

---

## 6.3 Session Lifecycle

### FR-8: Start Session
- User clicks "Start Session"
- Timer begins
- Fatigue monitoring active

### FR-9: Stop Session
- User clicks "End Session"
- Session summary generated
- Aggregated metrics sent to backend

---

## 6.4 Session Summary Payload

Frontend sends only aggregated data:

6.5 Backend Storage (Rails + PostgreSQL)
Users Table

id

email
encrypted_password
created_at
updated_at

Sessions Table
id
user_id
session_date
duration_minutes
avg_blink_rate
fatigue_score
long_closure_events
created_at
updated_at

6.6 Analytics APIs
Weekly Analytics Endpoint

GET /api/v1/analytics/weekly
Returns:
Average fatigue score
Fatigue score comparison vs previous week
Average blink rate
Longest session duration
Monthly Analytics Endpoint

GET /api/v1/analytics/monthly
Returns:
Monthly fatigue trend
High fatigue days count
Burnout risk level

7. Burnout Risk Logic (MVP Rule-Based)

Burnout Risk is HIGH if:
Fatigue score increases for 3 consecutive weeks
Average session duration > 240 minutes
Break frequency below threshold

Burnout Risk levels:
LOW
MEDIUM
HIGH

8. Non-Functional Requirements
Privacy

All facial processing must occur client-side.
No video or image data stored.
No facial landmark storage.
Explicit user consent required before webcam activation.
Privacy policy must clearly state data handling.

Rate limiting on API endpoints

Performance
Minimum 15 FPS processing
Session save response time < 500ms
No backend dependency for fatigue detection

9. UX Requirements
Dashboard Page
Start Session button
Real-time fatigue indicator
Blink counter
Timer
Stop Session button
Analytics Page
Weekly line chart
Monthly trend chart
Fatigue score comparison
Burnout risk badge
Session history table

10. Technical Architecture
Frontend

React (TypeScript)
MediaPipe FaceMesh
Custom Fatigue Engine module
Axios for API calls

Backend
Ruby on Rails (API-only mode)
PostgreSQL
JWT Authentication
Analytics service layer

11. System Flow

User logs in.
User starts session.
Browser runs fatigue detection locally.
Alerts shown in real time.

Session ends.
Aggregated metrics sent to backend.
Analytics computed via backend services.
Dashboard displays weekly/monthly insights.

12. Future Enhancements

Posture detection
Productivity correlation scoring
VS Code extension
Slack integration
Team dashboard
AI-driven fatigue prediction
Exportable PDF reports

13. Risks & Mitigation
Risk	Mitigation
False fatigue detection	Allow threshold customization
Privacy concerns	Clear consent messaging
Poor lighting affecting detection	Provide setup guidance
Low retention	Gamification & streak system

```json
{
  "session_date": "YYYY-MM-DD",
  "duration_minutes": 180,
  "avg_blink_rate": 9.2,
  "fatigue_score": 72,
  "long_closure_events": 4
}
