const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { initDB } = require('./db');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl/postman) with no Origin header.
    if (!origin) return callback(null, true);
    
    // Allow Chrome extensions (chrome-extension://*)
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    // Allow localhost origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());

if (process.env.NODE_ENV === 'production') {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const isCorsError = err instanceof Error && err.message.startsWith('CORS blocked for origin:');
  if (!isCorsError) {
    console.error(err);
  }

  res.status(isCorsError ? 403 : 500).json({
    error: isCorsError ? err.message : 'Internal server error',
  });
});

async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`DevWell API running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
