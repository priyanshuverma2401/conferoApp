const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;
if (config.emailEnabled) {
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  });
}

// Sends the password-reset email. When SMTP isn't configured, logs the link to
// the server console instead so the flow is fully testable in dev without an
// email account — deliberately never reveals the link to the HTTP response.
async function sendPasswordReset(email, resetUrl) {
  if (!transporter) {
    console.log(`[emailer] SMTP not configured. Password-reset link for ${email}:\n  ${resetUrl}`);
    return { sent: false };
  }

  await transporter.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: 'Reset your Confero password',
    html: `
      <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Reset your Confero password</h2>
        <p>We received a request to reset your password. Click below to set a new one. This link expires in 1 hour.</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Reset password</a></p>
        <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
  return { sent: true };
}

module.exports = { sendPasswordReset };
