const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ── QA telemetry log ────────────────────────────────────────────────────────
// A structured, append-only JSONL record of the full answer lifecycle, so every
// run can be validated at the backend: what was heard, whether it was detected
// as a question, when the answer fired, which providers were tried (each with
// its own latency + any error), which model actually answered, and how long the
// whole thing took. One event per line: { t, event, ...fields }.
//
// This is a TESTING aid. It's gated by CONFERO_QA_LOG (on by default during the
// testing phase); set CONFERO_QA_LOG=0 to disable for production builds.
const LOG_PATH = path.join(app.getPath('userData'), 'confero-qa.jsonl');
const ENABLED = process.env.CONFERO_QA_LOG !== '0';

function log(event, data = {}) {
  if (!ENABLED) return;
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n';
    fs.appendFile(LOG_PATH, line, () => {});
  } catch (_) { /* logging must never break the app */ }
}

// Trim long text so the log stays readable but still shows what was said/answered.
function preview(text, n = 400) {
  if (!text) return text;
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

module.exports = { log, preview, LOG_PATH, ENABLED };
