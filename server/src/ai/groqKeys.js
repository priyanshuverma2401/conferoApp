const config = require('../config');

// Groq key rotation, shared by CHAT (ai/chat.js) and TRANSCRIPTION (proxy.js).
//
// It has to be ONE module rather than a copy on each side: Groq's limits are per
// ACCOUNT, so a key that transcription just got a 429 on is equally throttled for
// chat. Two independent cooldown maps would each re-discover that the hard way,
// which is precisely the wasted round trip the cooldown exists to avoid.
//
// Vision/OCR deliberately does NOT use this — a Snip is rare and user-initiated,
// so it isn't what drains a quota, and leaving it on the single key keeps the
// rarely-exercised path simple.

// Groq's limit windows are per-minute, so a benched key is worth re-probing soon.
// Long enough that a throttled key isn't retried every few seconds; short enough
// that a brief burst doesn't sideline a key for the rest of the session.
const COOLDOWN_MS = 60 * 1000;
const coolUntil = new Map();

// Keys not currently known to be throttled, in configured order. If EVERY key is
// cooling down we return the whole pool rather than nothing: a cooldown is a
// GUESS about the near future, and refusing to try would turn that guess into a
// certain outage. Better to spend one request finding out we were wrong.
function liveKeys() {
  const now = Date.now();
  const pool = config.groqApiKeys;
  const live = pool.filter((k) => !(coolUntil.get(k) > now));
  return live.length ? live : pool;
}

const THROTTLED = Symbol('groq-throttled');
// Marks an error as "this key is rate-limited, try the next one". Anything NOT
// marked is a real failure (bad request, bad audio, model gone) and must bubble
// immediately — retrying it across every key would multiply one broken request
// into N and delay the user's error by the whole sweep.
function throttled(message) {
  const err = new Error(message);
  err[THROTTLED] = true;
  return err;
}
const isThrottled = (err) => Boolean(err && err[THROTTLED]);

function bench(key) { coolUntil.set(key, Date.now() + COOLDOWN_MS); }

// Runs `attempt(key)` against usable keys until one succeeds. The attempt is
// responsible for deciding what counts as throttling — it throws throttled(...)
// to move on, anything else to abort — because "429" arrives differently on the
// two call sites (a thrown upstream error in chat, a Response status in
// transcription).
async function withGroqKey(attempt) {
  const keys = liveKeys();
  if (!keys.length) throw new Error('No Groq API key is configured.');
  let lastErr;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const out = await attempt(key);
      coolUntil.delete(key); // answered — this key is alive again
      return out;
    } catch (err) {
      if (!isThrottled(err)) throw err;
      lastErr = err;
      bench(key);
      if (keys.length > 1) {
        console.warn(`[groq] key ${i + 1}/${keys.length} throttled — trying next`);
      }
    }
  }
  throw lastErr;
}

module.exports = { withGroqKey, throttled, isThrottled, keyCount: () => config.groqApiKeys.length };
