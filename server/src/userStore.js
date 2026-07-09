const fs = require('fs');
const path = require('path');

// Simple JSON-file user store — pure JS, no native DB dependency (avoids the
// node-gyp build wall). Fine for MVP/local and small scale; swap for a real DB
// (Postgres, etc.) when volume warrants, behind this same interface.
const DATA_DIR = path.join(__dirname, '../data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { users: [] };
    throw err;
  }
}

function persist(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, USERS_PATH);
}

function findByEmail(email) {
  const db = load();
  return db.users.find((u) => u.email === email.toLowerCase()) || null;
}

function findById(id) {
  const db = load();
  return db.users.find((u) => u.id === id) || null;
}

// Stamps a new active-session id on the user, invalidating any token that
// carried the previous one — this is what enforces "one device at a time."
function setSessionId(userId, sessionId) {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.sessionId = sessionId;
    persist(db);
  }
  return user;
}

function createUser({ email, passwordHash, provider = 'email' }) {
  const db = load();
  const user = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: email.toLowerCase(),
    passwordHash: passwordHash || null,
    provider,
    createdAt: new Date().toISOString(),
    plan: 'free',
  };
  db.users.push(user);
  persist(db);
  return user;
}

// For OAuth sign-in: reuse the existing account for this email if present,
// otherwise create a passwordless one tied to the provider.
function findOrCreateOAuthUser({ email, provider }) {
  return findByEmail(email) || createUser({ email, provider });
}

function setResetToken(userId, resetToken, resetExpires) {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.resetToken = resetToken;
    user.resetExpires = resetExpires;
    persist(db);
  }
  return user;
}

function findByResetToken(resetToken) {
  const db = load();
  return db.users.find((u) => u.resetToken === resetToken) || null;
}

function setPassword(userId, passwordHash) {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.passwordHash = passwordHash;
    delete user.resetToken;
    delete user.resetExpires;
    persist(db);
  }
  return user;
}

module.exports = {
  findByEmail,
  findById,
  setSessionId,
  createUser,
  findOrCreateOAuthUser,
  setResetToken,
  findByResetToken,
  setPassword,
};
