const { Pool } = require('pg');
const pino = require('pino');
require('dotenv').config();

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true } },
  }),
});

const pool = new Pool({
  user: process.env.DB_USER || 'dev16',
  host: process.env.DB_HOST || '/var/run/postgresql',
  database: process.env.DB_NAME || 'devwell_dev',
  password: process.env.DB_PASSWORD || 'password',
  port: parseInt(process.env.DB_PORT || '5432'),
  // Production pool tuning
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000'),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT || '5000'),
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        encrypted_password VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
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

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id_date ON sessions(user_id, session_date);
    `);
    logger.info('Database tables initialized');
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = { pool, initDB, closePool };
