const http = require('http');
const { shell } = require('electron');

// A sleeping free-tier Render instance takes tens of seconds to boot, and every
// request until then is answered by Render's own splash page. Poll until the
// service actually answers, then give up rather than hanging forever — an
// unreachable backend should still open the browser so the user sees a real
// error page instead of a button that silently does nothing.
const WAKE_TIMEOUT_MS = 60000;
const WAKE_POLL_MS = 1500;

async function waitForBackend(backendUrl) {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any of our own routes will do — 401 is a perfectly good "it's awake",
      // since it means OUR server answered rather than the platform's splash.
      const res = await fetch(`${backendUrl}/api/me`, {
        method: 'GET',
        signal: AbortSignal.timeout(WAKE_POLL_MS * 2),
      });
      if (res.status > 0) return true;
    } catch (_) { /* still asleep or unreachable — try again */ }
    await new Promise((r) => setTimeout(r, WAKE_POLL_MS));
  }
  return false;
}

// Opens the backend sign-in page in the user's browser and waits for it to hand
// the login token back to a short-lived localhost listener. This loopback
// pattern (used by the GitHub/AWS CLIs) avoids fragile custom-protocol
// registration and works the same in dev and packaged builds.
// `onStatus` reports progress back to the onboarding window — waking a cold
// server takes long enough that a silent button reads as broken.
function startSignin({ backendUrl, onStatus }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!DOCTYPE html><html><body style="background:#0e1116;color:#eef1f5;font-family:-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">` +
        `<div><h2 style="font-weight:600">You're signed in to Confero</h2>` +
        `<p style="opacity:.6">You can close this tab and return to the app.</p></div></body></html>`
      );

      cleanup();
      if (token) resolve({ token });
      else reject(new Error('No token received from sign-in.'));
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error('Sign-in timed out. Please try again.'));
    }, 5 * 60 * 1000);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
    }

    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      const redirect = `http://127.0.0.1:${port}/callback`;
      const signinUrl = `${backendUrl}/signin.html?redirect=${encodeURIComponent(redirect)}`;
      // Wake the backend BEFORE handing the URL to the browser. On a free Render
      // instance the service sleeps, and the first request is answered by
      // Render's own "SERVICE WAKING UP" splash instead of our sign-in page —
      // which is what the user sees, with no indication it's temporary or that
      // it belongs to us. Absorbing that cold start here means the browser opens
      // on a warm server and lands straight on the real page.
      if (onStatus) onStatus('Waking the server…');
      await waitForBackend(backendUrl);
      if (onStatus) onStatus('');
      shell.openExternal(signinUrl);
    });

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

module.exports = { startSignin };
