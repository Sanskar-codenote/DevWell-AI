const express = require('express');
const zod = require('zod');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const sessionSchema = zod.object({
  session_date: zod.preprocess((val) => {
    if (typeof val === 'string' && val.includes('T')) {
      return val.split('T')[0];
    }
    return val;
  }, zod.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)')),
  duration_minutes: zod.number().min(0),
  avg_blink_rate: zod.number().min(0),
  fatigue_score: zod.number().min(0).max(100),
  long_closure_events: zod.number().int().min(0).optional().default(0),
});

const listSessionsSchema = zod.object({
  limit: zod.preprocess((val) => (val === undefined ? undefined : Number(val)), zod.number().int().min(1).max(100).optional().default(20)),
  offset: zod.preprocess((val) => (val === undefined ? undefined : Number(val)), zod.number().int().min(0).optional().default(0)),
});

// POST /api/v1/sessions — save a completed session
router.post('/', authenticateToken, async (req, res) => {
  try {
    const validated = sessionSchema.safeParse(req.body);
    if (!validated.success) {
      console.error('[Sessions] Validation failed:', JSON.stringify(req.body));
      console.error('[Sessions] Zod issues:', JSON.stringify(validated.error.issues));
      console.error('[Sessions] Validated data so far:', JSON.stringify(validated.data));
      
      const details = validated.error.issues 
        ? validated.error.issues.map(e => e.message) 
        : [];

      return res.status(400).json({ 
        error: 'Validation failed', 
        details
      });
    }
    const { session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events } = validated.data;

    const result = await pool.query(
      `INSERT INTO sessions (user_id, session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, session_date, duration_minutes, avg_blink_rate, fatigue_score, long_closure_events]
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
    const validated = listSessionsSchema.safeParse(req.query);
    if (!validated.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: (validated.error.issues || validated.error.errors || []).map(e => e.message || e.toString()) 
      });
    }
    const { limit, offset } = validated.data;

    // Order by created_at DESC to show most recent sessions first
    // This ensures correct ordering even for multiple sessions on the same day
    const result = await pool.query(
      'SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.user.id, limit, offset]
    );

    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
