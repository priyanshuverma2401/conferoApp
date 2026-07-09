const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// The signed-in user's session token, persisted per-user in userData. Plaintext
// JSON for MVP (same trust level as the .env already stored here). Production
// upgrade: encrypt with Electron's safeStorage (OS keychain-backed).
function sessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(sessionPath(), 'utf-8'));
  } catch {
    cache = {};
  }
  return cache;
}

function saveSession({ token, email }) {
  cache = { token, email };
  const tmp = `${sessionPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, sessionPath());
  return cache;
}

function getToken() {
  return load().token || null;
}

function getEmail() {
  return load().email || null;
}

function hasSession() {
  return Boolean(getToken());
}

function clear() {
  cache = {};
  try {
    fs.unlinkSync(sessionPath());
  } catch {
    /* already gone */
  }
}

module.exports = { saveSession, getToken, getEmail, hasSession, clear };
