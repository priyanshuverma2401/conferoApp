const express = require('express');
const config = require('./config');
const { tokenFor } = require('./auth');
const userStore = require('./userStore');

const router = express.Router();

const SAFE_REDIRECT = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/callback$/;
const CALLBACK_PATH = '/api/auth/google/callback';

// Kick off Google sign-in. The desktop app's localhost callback is carried
// through Google's `state` param so we can bounce the token back at the end.
router.get('/google/start', (req, res) => {
  const appRedirect = req.query.redirect || '';
  if (!SAFE_REDIRECT.test(appRedirect)) {
    return res.status(400).send('Invalid redirect.');
  }
  if (!config.googleEnabled) {
    // Nothing to authenticate against yet — send the user back to the sign-in
    // page with a clear message rather than a broken Google error.
    const msg = encodeURIComponent('Google sign-in isn\'t set up yet. Use email for now.');
    return res.redirect(`/signin.html?redirect=${encodeURIComponent(appRedirect)}&error=${msg}`);
  }

  const state = Buffer.from(appRedirect).toString('base64url');
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${config.serverPublicUrl}${CALLBACK_PATH}`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  let appRedirect = '';
  try {
    appRedirect = Buffer.from(String(state || ''), 'base64url').toString('utf-8');
  } catch {
    /* invalid state */
  }
  if (!SAFE_REDIRECT.test(appRedirect)) return res.status(400).send('Invalid sign-in state.');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code || ''),
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: `${config.serverPublicUrl}${CALLBACK_PATH}`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error('Google token exchange failed.');
    const { access_token } = await tokenRes.json();

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) throw new Error('Could not read Google profile.');
    const profile = await infoRes.json();
    if (!profile.email) throw new Error('Google account has no email.');

    const user = await userStore.findOrCreateOAuthUser({ email: profile.email, provider: 'google' });
    const token = await tokenFor(user);
    res.redirect(`${appRedirect}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    const msg = encodeURIComponent(err.message);
    res.redirect(`/signin.html?redirect=${encodeURIComponent(appRedirect)}&error=${msg}`);
  }
});

module.exports = router;
