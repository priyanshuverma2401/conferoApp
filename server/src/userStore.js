const fs = require('fs');
const path = require('path');
const config = require('./config');

// User store with two interchangeable backends behind ONE async interface:
//   • MongoDB  — used when MONGODB_URI is set (production). Persistent: accounts,
//     plans, and session ids survive restarts/redeploys. REQUIRED for a hosted
//     deploy, because a plain file is wiped on every restart on free tiers.
//   • JSON file — the fallback for local dev with no Mongo running.
// Every function is async so the same calls work against either backend. The user
// document shape is identical in both, so nothing downstream cares which is live.

const useMongo = () => Boolean(config.mongoUri);

// ── Mongo backend ────────────────────────────────────────────────────────────
let collPromise = null;
function usersCollection() {
  if (!collPromise) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(config.mongoUri);
    collPromise = client.connect().then(async () => {
      const coll = client.db('confero').collection('users');
      await coll.createIndex({ email: 1 }, { unique: true });
      await coll.createIndex({ resetToken: 1 });
      return coll;
    });
  }
  return collPromise;
}

// ── File backend ─────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '../data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
function fileLoad() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { users: [] };
    throw err;
  }
}
function filePersist(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, USERS_PATH);
}
// Mongo returns documents with an internal `_id`; strip it so both backends hand
// back the same plain shape the rest of the code expects.
function clean(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

// ── Public async interface ───────────────────────────────────────────────────
async function findByEmail(email) {
  const e = (email || '').toLowerCase();
  if (useMongo()) return clean(await (await usersCollection()).findOne({ email: e }));
  return fileLoad().users.find((u) => u.email === e) || null;
}

async function findById(id) {
  if (useMongo()) return clean(await (await usersCollection()).findOne({ id }));
  return fileLoad().users.find((u) => u.id === id) || null;
}

// Stamps a new active-session id on the user, invalidating any token that carried
// the previous one — this is what enforces "one device at a time."
async function setSessionId(userId, sessionId) {
  if (useMongo()) {
    await (await usersCollection()).updateOne({ id: userId }, { $set: { sessionId } });
    return;
  }
  const db = fileLoad();
  const user = db.users.find((u) => u.id === userId);
  if (user) { user.sessionId = sessionId; filePersist(db); }
}

async function createUser({ email, passwordHash, provider = 'email' }) {
  const user = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: (email || '').toLowerCase(),
    passwordHash: passwordHash || null,
    provider,
    createdAt: new Date().toISOString(),
    plan: 'free',
  };
  if (useMongo()) {
    await (await usersCollection()).insertOne({ ...user });
    return user;
  }
  const db = fileLoad();
  db.users.push(user);
  filePersist(db);
  return user;
}

// For OAuth sign-in: reuse the existing account for this email if present,
// otherwise create a passwordless one tied to the provider.
async function findOrCreateOAuthUser({ email, provider }) {
  return (await findByEmail(email)) || createUser({ email, provider });
}

async function setResetToken(userId, resetToken, resetExpires) {
  if (useMongo()) {
    await (await usersCollection()).updateOne({ id: userId }, { $set: { resetToken, resetExpires } });
    return;
  }
  const db = fileLoad();
  const user = db.users.find((u) => u.id === userId);
  if (user) { user.resetToken = resetToken; user.resetExpires = resetExpires; filePersist(db); }
}

async function findByResetToken(resetToken) {
  if (!resetToken) return null;
  if (useMongo()) return clean(await (await usersCollection()).findOne({ resetToken }));
  return fileLoad().users.find((u) => u.resetToken === resetToken) || null;
}

async function setPassword(userId, passwordHash) {
  if (useMongo()) {
    await (await usersCollection()).updateOne(
      { id: userId },
      { $set: { passwordHash }, $unset: { resetToken: '', resetExpires: '' } },
    );
    return;
  }
  const db = fileLoad();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    user.passwordHash = passwordHash;
    delete user.resetToken;
    delete user.resetExpires;
    filePersist(db);
  }
}

// Sets a user's plan (e.g. 'premium' after a successful payment). Used by the
// billing webhook.
async function setPlan(userId, plan) {
  if (useMongo()) {
    await (await usersCollection()).updateOne({ id: userId }, { $set: { plan } });
    return;
  }
  const db = fileLoad();
  const user = db.users.find((u) => u.id === userId);
  if (user) { user.plan = plan; filePersist(db); }
}

// Generic partial update — merges the given fields onto the user. Used for the
// email-OTP fields (otpHash/otpExpires/otpAttempts) and Stripe customer id, so
// each new user attribute doesn't need its own hand-written setter/backend split.
// A field set to `undefined` is removed from the document.
async function updateUser(userId, fields) {
  if (useMongo()) {
    const set = {};
    const unset = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) unset[k] = '';
      else set[k] = v;
    }
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) await (await usersCollection()).updateOne({ id: userId }, update);
    return;
  }
  const db = fileLoad();
  const user = db.users.find((u) => u.id === userId);
  if (user) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete user[k];
      else user[k] = v;
    }
    filePersist(db);
  }
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
  setPlan,
  updateUser,
};
