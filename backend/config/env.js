function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  port: asInt(process.env.PORT, 3001),
  frontendPort: String(process.env.FRONTEND_PORT || '5173'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  otpExpiryMinutes: asInt(process.env.OTP_EXPIRY_MINUTES, 10),
  maxPendingOtp: asInt(process.env.MAX_PENDING_OTP_PER_EMAIL, 3),
  authWindowMinutes: asInt(process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES, 15),
  authMaxAttempts: asInt(process.env.AUTH_RATE_LIMIT_MAX, 5),
  otpWindowMinutes: asInt(process.env.OTP_RATE_LIMIT_WINDOW_MINUTES, 15),
  otpMaxAttempts: asInt(process.env.OTP_RATE_LIMIT_MAX, 3),
  apiRateLimitWindowMinutes: asInt(process.env.API_RATE_LIMIT_WINDOW_MINUTES, 15),
  apiRateLimitMax: asInt(process.env.API_RATE_LIMIT_MAX, 100),
  corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS || '',
  cspConnectSrc: process.env.CSP_CONNECT_SRC || "https://*.railway.app",
};

module.exports = env;
