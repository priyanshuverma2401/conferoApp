const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');
const userStore = require('./userStore');
const emailer = require('./emailer');

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sixDigitCode() {
  // 000000–999999, zero-padded. crypto.randomInt is uniform (no modulo bias).
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// A fresh session id is minted on every sign-in and stored on the user. The id
// is embedded in the token; the auth middleware rejects any token whose id no
// longer matches — so a new sign-in silently invalidates all older ones.
async function rotateSession(user) {
  const sessionId = crypto.randomBytes(16).toString('hex');
  await userStore.setSessionId(user.id, sessionId);
  return sessionId;
}

function issueToken(user, sessionId) {
  return jwt.sign({ sub: user.id, email: user.email, plan: user.plan, sid: sessionId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

async function tokenFor(user) {
  const sessionId = await rotateSession(user);
  return issueToken(user, sessionId);
}

async function signup(email, password) {
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Please enter a valid email address.');
  if (!password || password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (await userStore.findByEmail(email)) throw httpError(409, 'An account with this email already exists. Try signing in.');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userStore.createUser({ email, passwordHash });
  return { token: await tokenFor(user), user: publicUser(user) };
}

async function login(email, password) {
  const user = await userStore.findByEmail(email || '');
  if (!user) throw httpError(401, 'No account found for that email.');
  if (!user.passwordHash) throw httpError(401, 'This account uses Google sign-in.');
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) throw httpError(401, 'Incorrect password.');
  return { token: await tokenFor(user), user: publicUser(user) };
}

// Emails a reset link if the account exists. Always resolves the same way so a
// stranger can't probe which emails are registered.
async function forgotPassword(email) {
  const user = await userStore.findByEmail(email || '');
  if (user) {
    const resetToken = crypto.randomBytes(24).toString('hex');
    await userStore.setResetToken(user.id, resetToken, Date.now() + RESET_TTL_MS);
    const resetUrl = `${config.serverPublicUrl}/reset.html?token=${resetToken}`;
    await emailer.sendPasswordReset(user.email, resetUrl);
  }
  return { ok: true };
}

async function resetPassword(token, newPassword) {
  if (!newPassword || newPassword.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  const user = await userStore.findByResetToken(token || '');
  if (!user || !user.resetExpires || user.resetExpires < Date.now()) {
    throw httpError(400, 'This reset link is invalid or has expired. Please request a new one.');
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await userStore.setPassword(user.id, passwordHash);
  // Signing out everywhere after a reset is the safe default.
  return { token: await tokenFor(user), user: publicUser(user) };
}

// ── Passwordless email one-time-code login ───────────────────────────────────
// Step 1: email a 6-digit code. We create the account on first request (magic-
// link style) so a brand-new user can sign in with just their email. Only a
// bcrypt hash of the code is stored, with a short expiry and an attempt counter.
async function requestOtp(email) {
  const e = (email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw httpError(400, 'Please enter a valid email address.');

  let user = await userStore.findByEmail(e);
  if (!user) user = await userStore.createUser({ email: e, provider: 'email' });

  const code = sixDigitCode();
  const otpHash = await bcrypt.hash(code, 10);
  await userStore.updateUser(user.id, {
    otpHash,
    otpExpires: Date.now() + config.otpTtlMs,
    otpAttempts: 0,
  });
  await emailer.sendLoginCode(e, code);
  return { ok: true };
}

// Step 2: verify the code and sign in. Wrong/expired codes never reveal whether
// the email exists. Rotates the session on success (enforces single-device).
async function verifyOtp(email, code) {
  const e = (email || '').trim().toLowerCase();
  const submitted = String(code || '').trim();
  const invalid = () => httpError(400, 'That code is invalid or has expired. Request a new one.');

  const user = await userStore.findByEmail(e);
  if (!user || !user.otpHash || !user.otpExpires) throw invalid();
  if (user.otpExpires < Date.now()) {
    await userStore.updateUser(user.id, { otpHash: undefined, otpExpires: undefined, otpAttempts: undefined });
    throw invalid();
  }
  if ((user.otpAttempts || 0) >= config.otpMaxAttempts) {
    await userStore.updateUser(user.id, { otpHash: undefined, otpExpires: undefined, otpAttempts: undefined });
    throw httpError(429, 'Too many attempts. Request a new code.');
  }

  const ok = await bcrypt.compare(submitted, user.otpHash);
  if (!ok) {
    await userStore.updateUser(user.id, { otpAttempts: (user.otpAttempts || 0) + 1 });
    throw invalid();
  }

  // Consume the code so it can't be replayed.
  await userStore.updateUser(user.id, { otpHash: undefined, otpExpires: undefined, otpAttempts: undefined });
  return { token: await tokenFor(user), user: publicUser(user) };
}

// Express middleware (chain AFTER requireAuth) — rejects non-premium users from a
// premium-only endpoint. Uses the FRESH plan requireAuth attached, not the token
// claim, so a just-upgraded user isn't forced to re-login.
function requirePremium(req, res, next) {
  if (req.user && req.user.plan === 'premium') return next();
  return res.status(402).json({
    error: 'premium_required',
    message: 'This feature is part of Confero Premium. Upgrade to unlock it.',
  });
}

// Express middleware — rejects requests without a valid, current-session token.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }

  try {
    const user = await userStore.findById(decoded.sub);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    if (user.sessionId && decoded.sid !== user.sessionId) {
      return res.status(401).json({
        error: 'session_superseded',
        message: 'You were signed out because your account was used on another device.',
      });
    }
    // Carry the FRESH plan from the store (the token's plan claim can be stale
    // after an upgrade), so premium gating checks the current entitlement.
    req.user = { ...decoded, plan: user.plan };
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed.' });
  }
}

function publicUser(user) {
  return { id: user.id, email: user.email, plan: user.plan };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  signup,
  login,
  forgotPassword,
  resetPassword,
  requestOtp,
  verifyOtp,
  requireAuth,
  requirePremium,
  issueToken,
  tokenFor,
  httpError,
};
