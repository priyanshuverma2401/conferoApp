// End-of-session report: the plain-text transcript the user can copy, plus an AI
// summary of what actually happened. Both are produced ON DEMAND when the user
// ends a session — nothing is generated in the background during the call, so a
// live round never pays for it.

// Who "them" is depends on the session: in an interview the system stream is the
// interviewer, in a tutoring session the user IS the tutor and the other voice is
// the student. Getting this wrong makes the copied transcript read backwards.
const MODE_SPEAKERS = {
  interview: { system: 'Interviewer', mic: 'You' },
  dsa: { system: 'Interviewer', mic: 'You' },
  tutoring: { system: 'Student', mic: 'Tutor' },
  professional: { system: 'Them', mic: 'You' },
  general: { system: 'Them', mic: 'You' },
};
const speakersFor = (modeId) => MODE_SPEAKERS[modeId] || MODE_SPEAKERS.general;

// Elapsed (not wall-clock) time: unambiguous across timezones, and "what was said
// 12 minutes in" is what someone re-reading a transcript actually looks for.
function fmtElapsed(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

function stats(lines) {
  const startedAt = lines.length ? lines[0].timestamp : null;
  const endedAt = lines.length ? lines[lines.length - 1].timestamp : null;
  const words = lines.reduce((n, l) => n + l.text.trim().split(/\s+/).filter(Boolean).length, 0);
  return {
    startedAt,
    endedAt,
    durationMs: startedAt ? endedAt - startedAt : 0,
    duration: startedAt ? fmtDuration(endedAt - startedAt) : '',
    lines: lines.length,
    words,
  };
}

function renderLines(lines, modeId) {
  const t0 = lines.length ? lines[0].timestamp : Date.now();
  const who = speakersFor(modeId);
  return lines.map((l) => `[${fmtElapsed(l.timestamp - t0)}] ${l.source === 'system' ? who.system : who.mic}: ${l.text.trim()}`);
}

// The copyable artifact: a header the user can paste straight into notes, then
// the speaker-labeled conversation.
function formatTranscript(lines, { modeId, modeLabel, productName = 'Confero' } = {}) {
  if (!lines.length) return '';
  const s = stats(lines);
  const when = new Date(s.startedAt).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const head = [
    `${productName} — session transcript`,
    [modeLabel, when, s.duration, `${s.lines} lines`].filter(Boolean).join(' · '),
    '─'.repeat(48),
  ].join('\n');
  return `${head}\n${renderLines(lines, modeId).join('\n')}\n`;
}

// A long meeting blows past any single model's context, so summarize in passes:
// notes per chunk, then one summary over the notes. Chunks run sequentially —
// parallel calls just trip provider rate limits on the free tiers we run on.
const CHUNK_CHARS = 11000;

function chunk(rendered, budget) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const line of rendered) {
    if (size + line.length > budget && cur.length) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += line.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function summarize({ llmClient, promptBuilder, lines, modeId, modeLabel, modeContext, documentContext }) {
  if (!lines.length) return '';
  const rendered = renderLines(lines, modeId);
  const parts = chunk(rendered, CHUNK_CHARS);
  const system = 'You are a precise meeting and interview note-taker. You summarize only what is in the transcript.';

  let notes = null;
  if (parts.length > 1) {
    notes = [];
    for (let i = 0; i < parts.length; i++) {
      notes.push(await llmClient.getCompletion({
        systemPrompt: system,
        userPrompt: promptBuilder.buildTranscriptNotesPrompt({
          transcriptText: parts[i].join('\n'), part: i + 1, total: parts.length,
        }),
        task: 'notes',
      }));
    }
  }

  return llmClient.getCompletion({
    systemPrompt: system,
    userPrompt: promptBuilder.buildSessionSummaryPrompt({
      transcriptText: notes ? null : rendered.join('\n'),
      notes,
      modeId,
      modeLabel,
      modeContext,
      documentContext,
    }),
    // Longer token budget + the spoken-answer cleaners skipped: this is a
    // document to read, not a line to say.
    task: 'summary',
  });
}

module.exports = { formatTranscript, summarize, stats, fmtDuration };
