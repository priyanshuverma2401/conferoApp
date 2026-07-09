const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const auth = require('./auth');
const userStore = require('./userStore');
const { MODES } = require('./modes');
const proxyRouter = require('./proxy');
const googleAuthRouter = require('./googleAuth');

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

// Google OAuth (no-op-friendly when GOOGLE_CLIENT_ID/SECRET are unset).
app.use('/api/auth', googleAuthRouter);

// Who am I + plan. Re-reads the store (not the token claim) so a plan upgrade
// takes effect without forcing a re-login.
app.get('/api/me', auth.requireAuth, (req, res) => {
  const user = userStore.findById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  res.json({ email: user.email, plan: user.plan || 'free' });
});

// Curated mode personas — the desktop app fetches these at startup and falls
// back to its local copies if unreachable.
app.get('/api/modes', auth.requireAuth, (_req, res) => {
  res.json({ modes: MODES });
});

// --- AI proxy (auth-protected) ---
app.use('/api', proxyRouter);

app.listen(config.port, () => {
  console.log(`[confero-server] listening on http://localhost:${config.port}`);
});
