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
| `DB_USER` | PostgreSQL user | (Required) |
| `DB_NAME` | PostgreSQL database name | (Required) |
| `EXTENSION_ID` | Authorized Chrome Extension ID | (Optional in dev) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of allowed origins | (Localhost) |
| `SMTP_HOST` | SMTP server hostname | (Optional) |
| `SMTP_PORT` | SMTP server port | (Optional) |
| `SMTP_USER` | SMTP authentication username | (Optional) |
| `SMTP_PASS` | SMTP authentication password / app password | (Optional) |
| `SMTP_FROM` | Sender email address for OTP emails | (Optional) |

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
In production mode (`NODE_ENV=production`), the server strictly validates the `EXTENSION_ID`. For local development within Docker, this check is relaxed to a warning to facilitate testing with varying extension IDs.

## API Documentation
See the main `README.md` in the project root for general API endpoint information.
