const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const zod = require('zod');
const pino = require('pino');
const { randomInt } = require('crypto');
const { pool } = require('../db');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const router = express.Router();

const { sendOtpEmail } = require('../lib/mailer');

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

const registerSchema = zod.object({
  email: zod.string().email('Invalid email address'),
  password: zod.string().min(6, 'Password must be at least 6 characters'),
  otp: zod.string().min(1, 'Verification code is required'),
});

const loginSchema = zod.object({
  email: zod.string().email('Invalid email address'),
  password: zod.string().min(1, 'Password is required'),
});

const resetPasswordSchema = zod.object({
  email: zod.string().email('Invalid email address'),
  otp: zod.string().min(1, 'Verification code is required'),
  password: zod.string().min(6, 'Password must be at least 6 characters'),
});

// POST /api/v1/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const emailSchema = zod.object({
      email: zod.string().email('Invalid email address'),
    });
    const validated = emailSchema.safeParse(req.body);
    if (!validated.success) {
      const details = validated.error.issues ? validated.error.issues.map(e => e.message) : [];
      return res.status(400).json({ error: 'Validation failed', details });
    }
    const { email } = validated.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Clean up expired codes for this email
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND expires_at < NOW()', [email]);

    // Check recent sends to prevent abuse (max 3 pending codes per email)
    const pending = await pool.query(
      'SELECT COUNT(*) FROM otp_codes WHERE email = $1 AND expires_at > NOW() AND used = FALSE',
      [email]
    );
    if (parseInt(pending.rows[0].count, 10) >= 3) {
      return res.status(429).json({ error: 'Too many verification codes sent. Please try again later.' });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)',
      [email, otp, 'register', expiresAt]
    );

    await sendOtpEmail(email, otp, 'register');

    res.json({ message: 'Verification code sent' });
  } catch (err) {
    logger.error({ err }, 'Send OTP error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/register
router.post('/register', async (req, res) => {
  try {
    const validated = registerSchema.safeParse(req.body);
    if (!validated.success) {
      logger.warn({ body: req.body }, 'Registration validation failed');
      const details = validated.error.issues ? validated.error.issues.map(e => e.message) : [];
      return res.status(400).json({ 
        error: 'Validation failed', 
        details
      });
    }
    const { email, password, otp } = validated.data;

    // Verify OTP first to prevent email enumeration without a valid code
    const otpResult = await pool.query(
      'SELECT id FROM otp_codes WHERE email = $1 AND code = $2 AND purpose = $3 AND expires_at > NOW() AND used = FALSE ORDER BY created_at DESC LIMIT 1',
      [email, otp, 'register']
    );
    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Mark OTP as used
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, encrypted_password) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hashedPassword]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    logger.error({ err }, 'Register error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const validated = loginSchema.safeParse(req.body);
    if (!validated.success) {
      logger.warn({ body: req.body }, 'Login validation failed');
      const details = validated.error.issues ? validated.error.issues.map(e => e.message) : [];
      return res.status(400).json({ 
        error: 'Validation failed', 
        details
      });
    }
    const { email, password } = validated.data;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.encrypted_password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ user: { id: user.id, email: user.email }, token });
  } catch (err) {
    logger.error({ err }, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/auth/me
router.get('/me', require('../middleware/auth').authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Me endpoint error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const emailSchema = zod.object({
      email: zod.string().email('Invalid email address'),
    });
    const validated = emailSchema.safeParse(req.body);
    if (!validated.success) {
      const details = validated.error.issues ? validated.error.issues.map(e => e.message) : [];
      return res.status(400).json({ error: 'Validation failed', details });
    }
    const { email } = validated.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length === 0) {
      logger.warn({ email }, 'Password reset requested for unknown email');
      // Return same message to prevent email enumeration
      return res.json({ message: 'If an account exists, a reset code has been sent' });
    }

    // Clean up expired codes for this email
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND expires_at < NOW()', [email]);

    // Check recent sends to prevent abuse (max 3 pending codes per email)
    const pending = await pool.query(
      'SELECT COUNT(*) FROM otp_codes WHERE email = $1 AND purpose = $2 AND expires_at > NOW() AND used = FALSE',
      [email, 'reset_password']
    );
    if (parseInt(pending.rows[0].count, 10) >= 3) {
      return res.status(429).json({ error: 'Too many verification codes sent. Please try again later.' });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)',
      [email, otp, 'reset_password', expiresAt]
    );

    await sendOtpEmail(email, otp, 'reset_password');

    res.json({ message: 'Password reset code sent' });
  } catch (err) {
    logger.error({ err }, 'Forgot password error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const validated = resetPasswordSchema.safeParse(req.body);
    if (!validated.success) {
      logger.warn({ body: req.body }, 'Reset password validation failed');
      const details = validated.error.issues ? validated.error.issues.map(e => e.message) : [];
      return res.status(400).json({ error: 'Validation failed', details });
    }
    const { email, otp, password } = validated.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this email' });
    }

    const otpResult = await pool.query(
      'SELECT id FROM otp_codes WHERE email = $1 AND code = $2 AND purpose = $3 AND expires_at > NOW() AND used = FALSE ORDER BY created_at DESC LIMIT 1',
      [email, otp, 'reset_password']
    );
    if (otpResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Mark OTP as used
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET encrypted_password = $1, updated_at = NOW() WHERE email = $2',
      [hashedPassword, email]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    logger.error({ err }, 'Reset password error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
