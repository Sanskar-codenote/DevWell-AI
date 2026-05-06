const nodemailer = require('nodemailer');
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !user || !pass) {
    logger.warn('SMTP not fully configured. OTP emails will be logged to console only.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465,
    auth: { user, pass },
  });
}

const transporter = createTransporter();

async function sendOtpEmail(to, otp, purpose = 'register') {
  const from = process.env.SMTP_FROM || 'noreply@devwell.ai';
  const isReset = purpose === 'reset_password';
  const subject = isReset
    ? 'Your DevWell AI password reset code'
    : 'Your DevWell AI verification code';
  const introText = isReset
    ? 'You requested a password reset. Your verification code is:'
    : 'Your verification code is:';
  const text = `${introText}\n\n${otp}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.`;
  const html = `<p>${introText}</p><h2 style="font-size: 28px; letter-spacing: 4px;">${otp}</h2><p>This code will expire in 10 minutes.</p><p>If you did not request this, please ignore this email.</p>`;

  if (!transporter) {
    logger.info({ to, otp, subject, purpose }, 'Console OTP (SMTP not configured)');
    return;
  }

  try {
    await transporter.sendMail({ from, to, subject, text, html });
    logger.info({ to, purpose }, 'OTP email sent');
  } catch (err) {
    logger.error({ err, to, purpose }, 'Failed to send OTP email');
    throw new Error('Failed to send verification email');
  }
}

module.exports = { sendOtpEmail };
