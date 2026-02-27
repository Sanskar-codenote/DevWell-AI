const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'dev16',
  host: process.env.DB_HOST || '/var/run/postgresql',
  database: process.env.DB_NAME || 'devwell_dev',
  port: parseInt(process.env.DB_PORT || '5432'),
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
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
