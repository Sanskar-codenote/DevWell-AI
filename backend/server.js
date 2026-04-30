const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
require('dotenv').config();

const { initDB, closePool, pool } = require('./db');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const analyticsRoutes = require('./routes/analytics');

// ─── Structured Logger ──────────────────────────────────────────────────────
const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});

// ─── Environment Validation ─────────────────────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DB_USER', 'DB_NAME', 'DB_PORT'];
const PRODUCTION_ENV = ['DB_PASSWORD', 'CORS_ALLOWED_ORIGINS'];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.fatal({ missing }, 'Missing required environment variables');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    const missingProd = PRODUCTION_ENV.filter((key) => !process.env[key]);
    if (missingProd.length > 0) {
      logger.fatal({ missing: missingProd }, 'Missing required PRODUCTION environment variables');
      process.exit(1);
    }

    if (process.env.JWT_SECRET === 'change_me_in_real_use' || process.env.JWT_SECRET === 'change_me') {
      logger.fatal('JWT_SECRET must be changed from default value in production');
      process.exit(1);
    }
  }

  logger.info('Environment validated');
}

validateEnv();

// ─── Express App ────────────────────────────────────────────────────────────
const app = express();
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
const PORT = process.env.PORT || 3001;
const frontendPort = process.env.FRONTEND_PORT || '5173';

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// ─── CORS ───────────────────────────────────────────────────────────────────
const defaultAllowedOrigins = [
  `http://localhost:${frontendPort}`,
  `http://127.0.0.1:${frontendPort}`,
];

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl/postman) with no Origin header.
    if (!origin) return callback(null, true);

    // Allow browser extensions (chrome-extension://* or moz-extension://*)
    if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
      // Extract ID accurately (remove protocol and any trailing path/slashes)
      const extensionId = origin.split('://')[1].split('/')[0];
      
      const configuredIds = process.env.EXTENSION_ID 
        ? process.env.EXTENSION_ID.split(',').map(id => id.trim()) 
        : [];

      // Match found
      if (configuredIds.length > 0 && configuredIds.includes(extensionId)) {
        return callback(null, true);
      }

      // In production, require a match if EXTENSION_ID is configured
      if (process.env.NODE_ENV === 'production' && configuredIds.length > 0) {
        logger.warn({ origin, extensionId }, 'Extension request blocked — ID mismatch');
        return callback(null, false); // Return false instead of Error to avoid 500
      }

      // In development or if no IDs are configured, allow all extensions
      return callback(null, true);
    }

    // Allow listed origins
    if (allowedOrigins.includes(origin)) return callback(null, true);

    logger.warn({ origin }, 'CORS blocked for origin');
    return callback(null, false);
  },
  credentials: true,
}));

// ─── Rate Limiting ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { error: 'Too many requests, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

// ─── Deep Health Check ──────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {},
  };

  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = { status: 'ok', responseMs: Date.now() - start };
  } catch (err) {
    health.status = 'degraded';
    health.checks.database = { status: 'error', message: err.message };
    logger.error({ err }, 'Health check: database unreachable');
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const isCorsError = err instanceof Error && err.message.startsWith('CORS blocked for origin:');
  if (!isCorsError) {
    logger.error({ err, method: req.method, url: req.url }, 'Unhandled error');
  }

  res.status(isCorsError ? 403 : 500).json({
    error: isCorsError ? err.message : 'Internal server error',
  });
});

// ─── Server Startup ─────────────────────────────────────────────────────────
async function start() {
  await initDB();
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'DevWell API started');
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down gracefully…');
    server.close(async () => {
      logger.info('HTTP server closed');
      await closePool();
      process.exit(0);
    });

    // If server doesn't close in 10s, force shutdown
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
