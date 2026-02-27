const { pool } = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    // Create demo user
    const hashedPassword = await bcrypt.hash('demo123', 10);
    const userResult = await client.query(
      `INSERT INTO users (email, encrypted_password) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      ['demo@devwell.ai', hashedPassword]
    );
    const userId = userResult.rows[0].id;

    // Generate 30 days of session data
    const sessions = [];
    for (let i = 29; i >= 0; i--) {
      const numSessions = Math.random() > 0.3 ? (Math.random() > 0.5 ? 2 : 1) : 0;
      for (let j = 0; j < numSessions; j++) {
        const duration = 30 + Math.floor(Math.random() * 210);
        const blinkRate = 8 + Math.random() * 12;
        const baseFatigue = 20 + (29 - i) * 0.8; // gradually increasing fatigue trend
        const fatigue = Math.min(100, Math.max(0, baseFatigue + (Math.random() - 0.3) * 30));
        const closures = Math.floor(Math.random() * (fatigue > 60 ? 8 : 3));
        sessions.push({ dayOffset: i, duration, blinkRate, fatigue, closures });
      }
    }

    for (const s of sessions) {
      await client.query(
        `INSERT INTO sessions (user_id, session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events)
         VALUES ($1, CURRENT_DATE - $2::integer, $3, $4, $5, $6)`,
        [userId, s.dayOffset, s.duration, parseFloat(s.blinkRate.toFixed(1)), parseFloat(s.fatigue.toFixed(1)), s.closures]
      );
    }

    console.log(`Seeded ${sessions.length} sessions for demo@devwell.ai (password: demo123)`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
