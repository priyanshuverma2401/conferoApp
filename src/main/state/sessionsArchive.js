const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Past sessions live as one JSON file each under userData — nothing leaves the
// machine. A session is archived automatically when the user starts a fresh
// one, so the workspace always opens clean without losing what came before.
const SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions');

// Dynamic, human name: "Preeti — Mock interview — 7 Jul" beats "session_1720..."
// Priority for the subject: the uploaded document's first word (usually the
// candidate's name), else the first few words of the session context.
function deriveName({ docFileName, modeContext, modeLabel }) {
  let subject = null;
  if (docFileName) {
    subject = docFileName.replace(/\.[^.]+$/, '').split(/[\s._-]+/).filter(Boolean)[0] || null;
  }
  if (!subject && modeContext) {
    subject = modeContext.trim().split(/\s+/).slice(0, 3).join(' ');
    if (subject.length > 24) subject = `${subject.slice(0, 24)}…`;
  }
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return [subject, modeLabel, date].filter(Boolean).join(' — ');
}

async function archiveSession({ transcript, answers, modeId, modeLabel, modeContext, docFileName, summary }) {
  if ((!transcript || transcript.length === 0) && (!answers || answers.length === 0)) {
    return null; // nothing worth saving
  }
  await fs.promises.mkdir(SESSIONS_DIR, { recursive: true });
  const id = `session_${Date.now()}`;
  const record = {
    id,
    name: deriveName({ docFileName, modeContext, modeLabel }),
    savedAt: Date.now(),
    modeId,
    modeContext: modeContext || null,
    // Present when the user ended the session properly (which generates it);
    // null for a session that was simply superseded by starting a new one.
    summary: summary || null,
    transcript: transcript || [],
    answers: answers || [],
  };
  await fs.promises.writeFile(path.join(SESSIONS_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return { id, name: record.name };
}

async function listSessions() {
  try {
    const files = await fs.promises.readdir(SESSIONS_DIR);
    const sessions = [];
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await fs.promises.readFile(path.join(SESSIONS_DIR, f), 'utf-8'));
        sessions.push({
          id: raw.id, name: raw.name, savedAt: raw.savedAt,
          lines: (raw.transcript || []).length, hasSummary: Boolean(raw.summary),
        });
      } catch (_) { /* skip corrupt file */ }
    }
    return sessions.sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function getSession(id) {
  if (!/^session_\d+$/.test(id)) return null; // ids are internal — never path fragments
  try {
    return JSON.parse(await fs.promises.readFile(path.join(SESSIONS_DIR, `${id}.json`), 'utf-8'));
  } catch (_) {
    return null;
  }
}

module.exports = { archiveSession, listSessions, getSession };
