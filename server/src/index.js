const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const auth = require('./auth');
const userStore = require('./userStore');
const { MODES } = require('./modes');
const proxyRouter = require('./proxy');
const googleAuthRouter = require('./googleAuth');
const billing = require('./billing');

const app = express();

// Local desktop app calls this from a null/localhost origin — permissive for
// local dev. In production, lock this to the app's known origin.
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Auth ---
app.post('/api/auth/signup', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    res.json(await auth.signup(email, password));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/auth/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    res.json(await auth.login(email, password));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/auth/forgot', express.json(), async (req, res) => {
  try {
    res.json(await auth.forgotPassword((req.body || {}).email));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/auth/reset', express.json(), async (req, res) => {
  try {
    const { token, password } = req.body || {};
    res.json(await auth.resetPassword(token, password));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Passwordless email one-time-code login.
app.post('/api/auth/otp/request', express.json(), async (req, res) => {
  try {
    res.json(await auth.requestOtp((req.body || {}).email));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/auth/otp/verify', express.json(), async (req, res) => {
  try {
    const { email, code } = req.body || {};
    res.json(await auth.verifyOtp(email, code));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Google OAuth (no-op-friendly when GOOGLE_CLIENT_ID/SECRET are unset).
app.use('/api/auth', googleAuthRouter);

// --- Billing (PayPal) ---
// PayPal posts RAW bytes here and we verify the signature from the paypal-* headers
// — so this route must be registered BEFORE any JSON body parser touches it, and
// must use express.raw. We hand the whole headers object to the handler because
// PayPal's signature check needs several of them.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const result = await billing.handleWebhook(req.body, req.headers);
    res.json(result);
  } catch (err) {
    // A bad signature is a 400 to PayPal so it retries/marks it failed.
    res.status(400).json({ error: `Webhook error: ${err.message}` });
  }
});

// Start an upgrade — returns a PayPal approval URL the app opens in the browser.
app.post('/api/billing/checkout', auth.requireAuth, async (req, res) => {
  try {
    const user = await userStore.findById(req.user.sub);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
    res.json(await billing.createCheckoutSession(user));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Who am I + plan. Re-reads the store (not the token claim) so a plan upgrade
// takes effect without forcing a re-login.
app.get('/api/me', auth.requireAuth, async (req, res) => {
  const user = await userStore.findById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  res.json({ email: user.email, plan: user.plan || 'free' });
});

// Curated mode personas — the desktop app fetches these at startup and falls
// back to its local copies if unreachable.
app.get('/api/modes', auth.requireAuth, (req, res) => {
  // Ship the user's plan alongside the modes so the app can lock premium-only
  // cards (e.g. DSA & System Design) and show the upsell. The backend still
  // enforces gating independently on /api/suggest — this is only for UI state.
  res.json({ modes: MODES, plan: req.user.plan || 'free' });
});

// --- AI proxy (auth-protected) ---
app.use('/api', proxyRouter);

app.listen(config.port, () => {
  console.log(`[confero-server] listening on http://localhost:${config.port}`);
});
