const express = require('express');
const pino = require('pino');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const router = express.Router();

// GET /api/v1/analytics/weekly
router.get('/weekly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Current week stats (Mon-Sun)
    const currentWeek = await pool.query(`
      SELECT
        COALESCE(AVG(fatigue_score), 0) AS avg_fatigue_score,
        COALESCE(AVG(avg_blink_rate), 0) AS avg_blink_rate,
        COALESCE(MAX(duration_minutes), 0) AS longest_session,
        COUNT(*) AS total_sessions,
        COALESCE(SUM(duration_minutes), 0) AS total_minutes
      FROM sessions
      WHERE user_id = $1
        AND session_date >= date_trunc('week', CURRENT_DATE)
        AND session_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
    `, [userId]);

    // Previous week stats
    const prevWeek = await pool.query(`
      SELECT COALESCE(AVG(fatigue_score), 0) AS avg_fatigue_score
      FROM sessions
      WHERE user_id = $1
        AND session_date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
        AND session_date < date_trunc('week', CURRENT_DATE)
    `, [userId]);

    // Daily breakdown for current week
    const dailyBreakdown = await pool.query(`
      SELECT
        session_date,
        AVG(fatigue_score) AS avg_fatigue_score,
        AVG(avg_blink_rate) AS avg_blink_rate,
        SUM(duration_minutes) AS total_minutes,
        COUNT(*) AS session_count
      FROM sessions
      WHERE user_id = $1
        AND session_date >= date_trunc('week', CURRENT_DATE)
        AND session_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
      GROUP BY session_date
      ORDER BY session_date
    `, [userId]);

    const current = currentWeek.rows[0];
    const prev = prevWeek.rows[0];
    const fatigueDiff = parseFloat(current.avg_fatigue_score) - parseFloat(prev.avg_fatigue_score);

    res.json({
      avg_fatigue_score: parseFloat(parseFloat(current.avg_fatigue_score).toFixed(1)),
      fatigue_change: parseFloat(fatigueDiff.toFixed(1)),
      avg_blink_rate: parseFloat(parseFloat(current.avg_blink_rate).toFixed(1)),
      longest_session: parseFloat(parseFloat(current.longest_session).toFixed(1)),
      total_sessions: parseInt(current.total_sessions),
      total_minutes: parseFloat(parseFloat(current.total_minutes).toFixed(1)),
      daily: dailyBreakdown.rows.map(r => ({
        date: r.session_date,
        avg_fatigue_score: parseFloat(parseFloat(r.avg_fatigue_score).toFixed(1)),
        avg_blink_rate: parseFloat(parseFloat(r.avg_blink_rate).toFixed(1)),
        total_minutes: parseFloat(parseFloat(r.total_minutes).toFixed(1)),
        session_count: parseInt(r.session_count),
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Weekly analytics error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/analytics/monthly
router.get('/monthly', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Monthly trend (last 4 weeks)
    const weeklyTrend = await pool.query(`
      SELECT
        date_trunc('week', session_date)::date AS week_start,
        COALESCE(AVG(fatigue_score), 0) AS avg_fatigue_score,
        COALESCE(AVG(avg_blink_rate), 0) AS avg_blink_rate,
        COALESCE(SUM(duration_minutes), 0) AS total_minutes,
        COUNT(*) AS total_sessions
      FROM sessions
      WHERE user_id = $1
        AND session_date >= CURRENT_DATE - INTERVAL '28 days'
      GROUP BY date_trunc('week', session_date)
      ORDER BY week_start
    `, [userId]);

    // High fatigue days (score > 70)
    const highFatigueDays = await pool.query(`
      SELECT COUNT(DISTINCT session_date) AS count
      FROM sessions
      WHERE user_id = $1
        AND session_date >= CURRENT_DATE - INTERVAL '30 days'
        AND fatigue_score > 70
    `, [userId]);

    // Burnout risk calculation
    const weeks = weeklyTrend.rows;
    let burnoutRisk = 'LOW';

    if (weeks.length >= 3) {
      let consecutiveIncrease = 0;
      for (let i = 1; i < weeks.length; i++) {
        if (parseFloat(weeks[i].avg_fatigue_score) > parseFloat(weeks[i - 1].avg_fatigue_score)) {
          consecutiveIncrease++;
        } else {
          consecutiveIncrease = 0;
        }
      }

      const avgDuration = weeks.reduce((sum, w) => sum + parseFloat(w.total_minutes) / parseInt(w.total_sessions), 0) / weeks.length;

      if (consecutiveIncrease >= 2 && avgDuration > 240) {
        burnoutRisk = 'HIGH';
      } else if (consecutiveIncrease >= 2 || avgDuration > 240) {
        burnoutRisk = 'MEDIUM';
      }
    }

    // Daily data for the month
    const dailyData = await pool.query(`
      SELECT
        session_date,
        AVG(fatigue_score) AS avg_fatigue_score,
        AVG(avg_blink_rate) AS avg_blink_rate,
        SUM(duration_minutes) AS total_minutes,
        COUNT(*) AS session_count
      FROM sessions
      WHERE user_id = $1
        AND session_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY session_date
      ORDER BY session_date
    `, [userId]);

    res.json({
      weekly_trend: weeks.map(w => ({
        week_start: w.week_start,
        avg_fatigue_score: parseFloat(parseFloat(w.avg_fatigue_score).toFixed(1)),
        avg_blink_rate: parseFloat(parseFloat(w.avg_blink_rate).toFixed(1)),
        total_minutes: parseFloat(parseFloat(w.total_minutes).toFixed(1)),
        total_sessions: parseInt(w.total_sessions),
      })),
      high_fatigue_days: parseInt(highFatigueDays.rows[0].count),
      burnout_risk: burnoutRisk,
      daily: dailyData.rows.map(r => ({
        date: r.session_date,
        avg_fatigue_score: parseFloat(parseFloat(r.avg_fatigue_score).toFixed(1)),
        avg_blink_rate: parseFloat(parseFloat(r.avg_blink_rate).toFixed(1)),
        total_minutes: parseFloat(parseFloat(r.total_minutes).toFixed(1)),
        session_count: parseInt(r.session_count),
      })),
    });
  } catch (err) {
    logger.error({ err }, 'Monthly analytics error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
