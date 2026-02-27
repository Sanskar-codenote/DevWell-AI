const express = require('express');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/v1/sessions — save a completed session
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events } = req.body;

    if (!session_date || duration_minutes == null || avg_blink_rate == null || fatigue_score == null) {
      return res.status(400).json({ error: 'Missing required session fields' });
    }

    const result = await pool.query(
      `INSERT INTO sessions (user_id, session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events || 0]
    );

    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/sessions — list user sessions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      'SELECT * FROM sessions WHERE user_id = $1 ORDER BY session_date DESC LIMIT $2 OFFSET $3',
      [req.user.id, limit, offset]
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
