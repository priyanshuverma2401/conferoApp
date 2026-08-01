// Full-window session report: summary + transcript as a readable document, and
// a grounded Q&A dock over both. All the thinking happens in main (the LLM calls
// live there); this file is presentation, plus the transcript parser that turns
// the copyable plain-text artifact back into structured rows.
const api = window.reportAPI;
const { normalizeSummary, parseSummary } = window.SummaryFormat;

const el = (id) => document.getElementById(id);
const rTitle = el('rTitle');
const rMeta = el('rMeta');
const rSaved = el('rSaved');
const rDoc = el('rDoc');
const rScroll = el('rScroll');
const rCopy = el('rCopy');
const rCopyLabel = el('rCopyLabel');
const rRegen = el('rRegen');
const rClose = el('rClose');
const rFindWrap = el('rFindWrap');
const rFind = el('rFind');
const rFindCount = el('rFindCount');
const rAsk = el('rAsk');
const rAskHead = el('rAskHead');
const rClear = el('rClear');
const rCollapse = el('rCollapse');
const rThread = el('rThread');
const rChips = el('rChips');
const rForm = el('rForm');
const rInput = el('rInput');
const rSend = el('rSend');
const rAskFoot = el('rAskFoot');

let report = null;      // the payload from main
let tab = 'summary';
let asking = false;
let regenerating = false;
let transcriptRows = []; // parsed once per report, re-filtered on search

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Summary → document markup ─────────────────────────────────────────────
// The shape repair lives in summaryFormat.js (shared with the overlay); here it
// only becomes headings and real lists.
function summaryDoc(text) {
  const sections = parseSummary(text);
  if (!sections.length) return '<div class="state"><h2>The summary came back empty</h2><p>Use Regenerate to try again — the transcript is unaffected.</p></div>';
  const out = [];
  for (const sec of sections) {
    out.push('<section class="s-sec">');
    if (sec.head) out.push(`<h2 class="s-head">${escapeHtml(sec.head)}</h2>`);
    let inList = false;
    for (const b of sec.blocks) {
      if (b.type === 'bullet') {
        if (!inList) { out.push('<ul class="s-list">'); inList = true; }
        out.push(`<li>${escapeHtml(b.text)}</li>`);
      } else {
        if (inList) { out.push('</ul>'); inList = false; }
        out.push(`<p class="s-p">${escapeHtml(b.text)}</p>`);
      }
    }
    if (inList) out.push('</ul>');
    out.push('</section>');
  }
  return out.join('');
}

// ── Transcript → speaker rows ─────────────────────────────────────────────
// formatTranscript writes "[mm:ss] Speaker: text" under a three-line header. A
// line that doesn't match is a continuation of the one before it (a transcript
// chunk that itself contained a newline), never a new turn.
const TURN_RE = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+([^:]{1,28}):\s*([\s\S]*)$/;

function parseTranscript(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const m = TURN_RE.exec(line);
    if (m) rows.push({ time: m[1], who: m[2].trim(), text: m[3] });
    // Anything before the first turn is the file header — already shown in the
    // title bar, so it is dropped rather than repeated in the body.
    else if (rows.length && line.trim()) rows[rows.length - 1].text += `\n${line}`;
  }
  return rows;
}

// "You" is whoever was wearing the app; colouring it differently is what makes a
// transcript skimmable at a glance.
const isSelf = (who) => /^(you|tutor|me)$/i.test(who);

function highlight(text, needle) {
  const safe = escapeHtml(text);
  if (!needle) return safe;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}

function transcriptDoc() {
  if (!transcriptRows.length) {
    // A transcript we couldn't parse is still a transcript — show it verbatim
    // rather than an empty pane.
    return report.transcript
      ? `<pre class="t-raw">${escapeHtml(report.transcript)}</pre>`
      : '<div class="t-empty">Nothing was captured in this session.</div>';
  }
  const q = rFind.value.trim();
  const needle = q.toLowerCase();
  let hits = 0;
  const html = transcriptRows.map((r) => {
    const match = !needle || r.text.toLowerCase().includes(needle) || r.who.toLowerCase().includes(needle);
    if (needle && match) hits += 1;
    return `<div class="t-line${isSelf(r.who) ? ' self' : ''}${needle && !match ? ' dim' : ''}">
      <span class="t-time">${escapeHtml(r.time)}</span>
      <span class="t-who">${escapeHtml(r.who)}</span>
      <span class="t-text">${highlight(r.text, q)}</span>
    </div>`;
  }).join('');
  rFindCount.textContent = needle ? (hits ? `${hits} match${hits === 1 ? '' : 'es'}` : 'No matches') : '';
  return html;
}

// ── Render ────────────────────────────────────────────────────────────────
// Ragged line widths (set in CSS, not inline — the page runs under a strict CSP)
// so the placeholder reads as text being written rather than as a loading bar.
const SKELETON = `<div class="skel">
  <div class="skel-sec"><div class="skel-h"></div><div class="skel-l"></div><div class="skel-l"></div></div>
  <div class="skel-sec"><div class="skel-h"></div><div class="skel-l"></div><div class="skel-l"></div><div class="skel-l"></div></div>
  <div class="skel-sec"><div class="skel-h"></div><div class="skel-l"></div><div class="skel-l"></div></div>
  <p class="skel-note">Reading back the session and writing the summary…</p>
</div>`;

function currentText() {
  if (!report) return '';
  return tab === 'transcript' ? report.transcript : report.summary;
}

function render() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tab);
  });
  rScroll.classList.toggle('is-transcript', tab === 'transcript');
  rFindWrap.classList.toggle('hidden', tab !== 'transcript' || !transcriptRows.length);
  rCopyLabel.textContent = tab === 'transcript' ? 'Copy transcript' : 'Copy summary';
  rCopy.title = tab === 'transcript' ? 'Copy the full transcript' : 'Copy the summary';
  rCopy.classList.remove('copied');
  // Regenerate only makes sense for the generated half.
  rRegen.classList.toggle('hidden', tab !== 'summary');

  if (!report) {
    rDoc.innerHTML = '<div class="state"><h2>Wrapping up…</h2><p>Assembling the transcript.</p></div>';
    rCopy.disabled = true;
    rRegen.disabled = true;
    return;
  }

  if (report.empty) {
    rDoc.innerHTML = '<div class="state"><h2>Nothing was captured</h2><p>This session has no transcript yet, so there\'s nothing to summarize. Start a session and let it hear some conversation first.</p></div>';
    rCopy.disabled = true;
    rRegen.disabled = true;
    return;
  }

  if (tab === 'transcript') {
    rDoc.innerHTML = transcriptDoc();
    rCopy.disabled = !report.transcript;
  } else if (report.generating || regenerating) {
    rDoc.innerHTML = SKELETON;
    rCopy.disabled = true;
  } else if (report.summary) {
    // A failed REGENERATE leaves the previous summary standing — say so, or the
    // click looks like it did nothing.
    const notice = report.error
      ? `<div class="notice">Couldn't write a new summary: ${escapeHtml(report.error)} — showing the previous one.</div>`
      : '';
    rDoc.innerHTML = notice + summaryDoc(report.summary);
    rCopy.disabled = false;
  } else {
    rDoc.innerHTML = `<div class="state err"><h2>Couldn't generate the summary</h2><p>${escapeHtml(report.error || 'The model did not return anything.')}</p><p>The transcript is unaffected — switch tabs to read or copy it, or use Regenerate.</p></div>`;
    rCopy.disabled = true;
  }
  rRegen.disabled = regenerating || Boolean(report.generating);
  rRegen.querySelector('span').textContent = (regenerating || report.generating) ? 'Writing…' : 'Regenerate';
}

function renderHead() {
  if (!report) return;
  rTitle.textContent = report.title || 'Session report';
  const s = report.stats || {};
  const when = s.startedAt
    ? new Date(s.startedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  rMeta.textContent = report.empty
    ? 'No conversation captured'
    : [report.modeLabel, when, s.duration, s.lines ? `${s.lines} lines` : null,
      report.answered ? `${report.answered} answered` : null].filter(Boolean).join('  ·  ');
  rSaved.textContent = report.saved
    ? `Saved to Past sessions as “${report.saved.name}”`
    : report.empty ? '' : 'Saved to Past sessions';
}

function applyReport(next) {
  const firstLoad = !report;
  report = next || null;
  if (report && report.transcript) transcriptRows = parseTranscript(report.transcript);
  renderHead();
  render();
  if (firstLoad) {
    renderChips();
    if (report && Array.isArray(report.chat) && report.chat.length) {
      report.chat.forEach((m) => { addMsg('q', m.q); addMsg('a', m.a); });
    }
    setAskEnabled(!!report && !report.empty);
  }
}

// ── Copy ──────────────────────────────────────────────────────────────────
function copyNow(text, btn) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    clearTimeout(btn._t);
    btn._t = setTimeout(() => btn.classList.remove('copied'), 1600);
  }).catch(() => {
    btn.classList.remove('copied');
  });
}

rCopy.addEventListener('click', () => copyNow(currentText(), rCopy));

// ── Tabs / search ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    tab = t.getAttribute('data-tab');
    render();
    rScroll.scrollTop = 0;
    if (tab === 'transcript' && transcriptRows.length) rFind.focus();
  });
});
rFind.addEventListener('input', () => {
  if (tab !== 'transcript') return;
  rDoc.innerHTML = transcriptDoc();
  const first = rDoc.querySelector('.t-line:not(.dim) mark');
  if (first) first.scrollIntoView({ block: 'center' });
});

// ── Regenerate ────────────────────────────────────────────────────────────
rRegen.addEventListener('click', async () => {
  if (regenerating || !report || report.empty) return;
  regenerating = true;
  tab = 'summary';
  render();
  try {
    const next = await api.regenerate();
    if (next && !next.error) applyReport({ ...report, ...next });
    else if (next && next.error) report.error = next.error;
  } finally {
    regenerating = false;
    render();
  }
});

// ── Ask about this meeting ────────────────────────────────────────────────
const CHIPS = {
  interview: ['What questions was I asked?', 'Where were my answers weak?', 'What should I follow up on?'],
  dsa: ['What problems came up?', 'Summarize my approach and complexity', 'What did I miss?'],
  tutoring: ['What did the student struggle with?', 'What should we cover next?', 'List the action items'],
  professional: ['What did we decide?', 'What are my action items?', 'What was left unresolved?'],
  general: ['What are the action items?', 'What were the key decisions?', 'What did I commit to?'],
};

function renderChips() {
  if (!report || report.empty || (report.chat && report.chat.length)) { rChips.innerHTML = ''; return; }
  const list = CHIPS[report.modeId] || CHIPS.general;
  rChips.innerHTML = list.map((q) => `<button type="button" class="chip">${escapeHtml(q)}</button>`).join('');
  rChips.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => { rInput.value = c.textContent; ask(); });
  });
}

function setAskEnabled(on) {
  rInput.disabled = !on;
  rSend.disabled = !on;
  if (!on) {
    rInput.placeholder = 'Nothing was captured in this session.';
    rAskFoot.textContent = '';
  }
}

// Answers are plain text with "- " bullets — same house style as the summary.
function answerHtml(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  let inList = false;
  for (const line of lines) {
    if (/^[-–—•*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(line.replace(/^[-–—•*]\s+/, ''))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('') || '<p></p>';
}

function addMsg(kind, text, { pending = false, error = false } = {}) {
  rThread.classList.remove('hidden');
  rAskHead.classList.remove('hidden');
  rAsk.classList.remove('collapsed');
  const wrap = document.createElement('div');
  wrap.className = `msg ${kind}${error ? ' err' : ''}`;
  if (kind === 'q') {
    wrap.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  } else if (pending) {
    wrap.innerHTML = '<div class="bubble"><span class="dots"><span></span><span></span><span></span></span></div>';
  } else {
    wrap.innerHTML = `<div class="bubble">${answerHtml(text)}</div>`;
    if (!error) {
      const tools = document.createElement('div');
      tools.className = 'msg-tools';
      const copy = document.createElement('button');
      copy.className = 'msg-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          copy.textContent = 'Copied ✓';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        }).catch(() => {});
      });
      tools.appendChild(copy);
      wrap.appendChild(tools);
    }
  }
  rThread.appendChild(wrap);
  rThread.scrollTop = rThread.scrollHeight;
  return wrap;
}

async function ask() {
  const q = rInput.value.trim();
  if (!q || asking || !report || report.empty) return;
  asking = true;
  rInput.value = '';
  autoGrow();
  rChips.innerHTML = '';
  rSend.disabled = true;
  addMsg('q', q);
  const pending = addMsg('a', '', { pending: true });
  try {
    const res = await api.ask(q);
    pending.remove();
    if (res && res.answer) addMsg('a', res.answer);
    else addMsg('a', (res && res.error) || "Couldn't answer that one.", { error: true });
  } catch (err) {
    pending.remove();
    addMsg('a', err.message, { error: true });
  } finally {
    asking = false;
    rSend.disabled = false;
    rInput.focus();
  }
}

// Clear drops the thread on BOTH sides — leaving main's copy in place would keep
// feeding retired turns back as context for the next question.
rClear.addEventListener('click', async () => {
  rThread.innerHTML = '';
  rThread.classList.add('hidden');
  rAskHead.classList.add('hidden');
  rAsk.classList.remove('collapsed');
  if (report) report.chat = [];
  renderChips();
  try { await api.clearChat(); } catch (_) { /* nothing to clear */ }
});
// Collapsing hands the window back to the document without losing the thread.
rCollapse.addEventListener('click', () => {
  const collapsed = rAsk.classList.toggle('collapsed');
  rCollapse.title = collapsed ? 'Show the thread' : 'Hide the thread';
});

rForm.addEventListener('submit', (e) => { e.preventDefault(); ask(); });
rInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
});
function autoGrow() {
  rInput.style.height = 'auto';
  rInput.style.height = `${Math.min(rInput.scrollHeight, 132)}px`;
}
rInput.addEventListener('input', autoGrow);

// ── Window chrome ─────────────────────────────────────────────────────────
rClose.addEventListener('click', () => api.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement !== rInput) api.close();
  // Ctrl+F is what anyone reaching for "where did they say X" presses.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (tab !== 'transcript') { tab = 'transcript'; render(); }
    rFind.focus();
    rFind.select();
  }
});

// Main pushes an update whenever the summary lands, the archive is written, or a
// regenerate finishes; the initial fetch covers a window that was reloaded.
api.onData(applyReport);
api.get().then(applyReport).catch(() => { /* main will push */ });
