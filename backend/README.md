# DevWell Backend

The backend service for DevWell AI, providing authentication, session management, and analytics.

## Features
- **Authentication**: JWT-based user registration and login.
- **Session Management**: Secure storage and retrieval of monitoring sessions.
- **Analytics**: Weekly and monthly trend data for users.
- **Security**: CORS protection (with extension ID support), rate limiting, and helmet security headers.
- **Database**: PostgreSQL with automatic table initialization.

## Prerequisites
- Node.js (LTS)
- PostgreSQL 16

## Quick Start

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Configure environment**:
    Create a `.env` file based on `.env.example`:
    ```env
    PORT=3001
    JWT_SECRET=your_secret_here
    DB_USER=your_db_user
    DB_NAME=devwell_dev
    # ... other vars
    ```

3.  **Start the server**:
    ```bash
    npm start
    ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3001` |
| `JWT_SECRET` | Secret key for JWT signing | (Required) |
| `DATABASE_URL` | Full PostgreSQL connection string | Optional (overrides individual DB_* vars) |
| `DB_USER` | PostgreSQL user | (Required if DATABASE_URL not set) |
| `DB_PASSWORD` | PostgreSQL password | Required in production (if DATABASE_URL not set) |
| `DB_NAME` | PostgreSQL database name | (Required if DATABASE_URL not set) |
| `DB_PORT` | PostgreSQL port | `5432` (if DATABASE_URL not set) |
| `EXTENSION_ID` | Authorized extension IDs (comma-separated) | Optional |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins | (Localhost) |
| `SMTP_HOST` | SMTP server hostname | (Optional) |
| `SMTP_PORT` | SMTP server port | (Optional) |
| `SMTP_USER` | SMTP authentication username | (Optional) |
| `SMTP_PASS` | SMTP authentication password / app password | (Optional) |
| `SMTP_FROM` | Sender email address for OTP emails | (Optional) |
| `FRONTEND_BUILD_PATH` | Optional path to frontend production build | `../frontend/dist` |

## OTP / Email Configuration
To enable real email delivery for signup verification codes, configure the `SMTP_*` variables in your `.env` file. If SMTP is not configured, OTPs are printed to the server console only (useful for local development).

### Gmail / Google Workspace
1. Enable **2-Factor Authentication** on your Google account.
2. Generate an **App Password** at [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (select app: *Mail*, device: *Other*).
3. Copy the 16-character password into `SMTP_PASS`.
4. Use your full Gmail address for both `SMTP_USER` and `SMTP_FROM`.

### SendGrid
Use `smtp.sendgrid.net:587` with `SMTP_USER=apikey` and your SendGrid API key as `SMTP_PASS`.

## Development Note
In production mode (`NODE_ENV=production`):
- `JWT_SECRET` must be at least 32 characters and must not use placeholder defaults.
- `CORS_ALLOWED_ORIGINS` is required.
- `DB_PASSWORD` is required when using individual DB_* variables (not needed if using `DATABASE_URL`).
- `EXTENSION_ID` is optional. If not set, all extension origins are allowed.
- Extension origins are allowed only when their ID matches configured values (if EXTENSION_ID is set).

## API Documentation
See the main `README.md` in the project root for general API endpoint information.
