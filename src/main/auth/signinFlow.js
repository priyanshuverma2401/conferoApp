const http = require('http');
const { shell } = require('electron');

// Opens the backend sign-in page in the user's browser and waits for it to hand
// the login token back to a short-lived localhost listener. This loopback
// pattern (used by the GitHub/AWS CLIs) avoids fragile custom-protocol
// registration and works the same in dev and packaged builds.
function startSignin({ backendUrl }) {
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

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const redirect = `http://127.0.0.1:${port}/callback`;
      const signinUrl = `${backendUrl}/signin.html?redirect=${encodeURIComponent(redirect)}`;
      shell.openExternal(signinUrl);
    });

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

module.exports = { startSignin };
