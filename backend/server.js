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

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`DevWell API running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
