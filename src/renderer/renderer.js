// TESTING ONLY: shows which model/key answered ("Gemini · flash · key 3/14")
// in the answer meta line. Set to false (or delete) for the production/web build
// to hide it from end users — nothing else depends on it.
const SHOW_MODEL_BADGE = true;

const appEl = document.getElementById('app');
const transcriptPane = document.getElementById('transcript-pane');
const suggestionsPane = document.getElementById('suggestions-pane');
const transcriptEmpty = document.getElementById('transcriptEmpty');
const suggestionsEmpty = document.getElementById('suggestionsEmpty');
const titleEl = document.getElementById('title');
const startBtn = document.getElementById('startBtn');
const activeActions = document.getElementById('activeActions');
const helpNowBtn = document.getElementById('helpNowBtn');
const quickAnswerRow = document.getElementById('quickAnswerRow');
const recapBtn = document.getElementById('recapBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const endBtn = document.getElementById('endBtn');
const closeBtn = document.getElementById('closeBtn');
const hbToggle = document.getElementById('hbToggle');
const hbToggleLabel = document.getElementById('hbToggleLabel');
const hbEnd = document.getElementById('hbEnd');
const errorBanner = document.getElementById('error-banner');
const modeChip = document.getElementById('modeChip');
const upgradeBtn = document.getElementById('upgradeBtn');
const modeEmoji = document.getElementById('modeEmoji');
const modeLabel = document.getElementById('modeLabel');
const modeMenu = document.getElementById('modeMenu');
const modeItemsList = document.getElementById('modeItemsList');
const modeContextEdit = document.getElementById('modeContextEdit');
const guardrailLock = document.getElementById('guardrail-lock');
const guardrailMsg = document.getElementById('guardrail-msg');
const paneDivider = document.getElementById('paneDivider');
const ticker = document.getElementById('ticker');
const tickerText = document.getElementById('tickerText');
const historyBtn = document.getElementById('historyBtn');
const codeAssistBtn = document.getElementById('codeAssistBtn');

// Answer Stage
const answerStage = document.getElementById('answerStage');
const stageQ = document.getElementById('stageQ');
const stageModel = document.getElementById('stageModel');
const stageNote = document.getElementById('stageNote');
const stageAnswer = document.getElementById('stageAnswer');
const stageUpnext = document.getElementById('stageUpnext');
const stageUpBtn = document.getElementById('stageUpBtn');
const stageDiff = document.getElementById('stageDiff');
const stageUpsellHint = document.getElementById('stageUpsellHint');
const stageMeta = document.getElementById('stageMeta');
const dockTip = document.getElementById('dockTip');
const dockTipClose = document.getElementById('dockTipClose');

// Session gate + consent + sessions + upsell
const sessionGate = document.getElementById('sessionGate');
const gateTitle = document.getElementById('gateTitle');
const gateSub = document.getElementById('gateSub');
const gateContext = document.getElementById('gateContext');
const gateVocab = document.getElementById('gateVocab');
const gateDocName = document.getElementById('gateDocName');
const gateDocBtn = document.getElementById('gateDocBtn');
const gateDocRemove = document.getElementById('gateDocRemove');
const gateClearSaved = document.getElementById('gateClearSaved');
const gateClose = document.getElementById('gateClose');
const gateSave = document.getElementById('gateSave');
const gateSkip = document.getElementById('gateSkip');
const consentModal = document.getElementById('consentModal');
const consentAsk = document.getElementById('consentAsk');
const consentWarning = document.getElementById('consentWarning');
const consentPractice = document.getElementById('consentPractice');
const consentLive = document.getElementById('consentLive');
const consentExit = document.getElementById('consentExit');
const sessionsModal = document.getElementById('sessionsModal');
const sessionsList = document.getElementById('sessionsList');
const sessionViewer = document.getElementById('sessionViewer');
const sessionTools = document.getElementById('sessionTools');
const svOpenFull = document.getElementById('svOpenFull');
const svCopySummary = document.getElementById('svCopySummary');
const svCopyTranscript = document.getElementById('svCopyTranscript');
const sessionsBack = document.getElementById('sessionsBack');
const sessionsClose = document.getElementById('sessionsClose');
const purposeGate = document.getElementById('purposeGate');
const purposeList = document.getElementById('purposeList');
const upsellModal = document.getElementById('upsellModal');
const upsellMsg = document.getElementById('upsellMsg');
const upsellClose = document.getElementById('upsellClose');

let isCapturing = false;
let errorHideTimer = null;
let plan = 'free';
let activeModeId = 'tutoring';
let modes = [];
let lastAnswerSubstance = null;
let currentFeedCard = null;
let consentedThisRun = false; // mock-interview ethics check, once per app run

function showBanner(message, ok) {
  errorBanner.textContent = message;
  errorBanner.classList.toggle('ok', Boolean(ok));
  errorBanner.style.display = 'block';
  clearTimeout(errorHideTimer);
  errorHideTimer = setTimeout(() => { errorBanner.style.display = 'none'; }, ok ? 5000 : 9000);
}
const showError = (m) => showBanner(m, false);
const showNote = (m) => showBanner(m, true);

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Scroll pinning: only autoscroll when the user is already at the bottom.
function pinnedAppend(pane, el) {
  const pinned = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48;
  pane.appendChild(el);
  if (pinned) pane.scrollTop = pane.scrollHeight;
}

// Newest-question-first reading. Cards are still appended in order, but the one
// that just landed is pulled to the TOP of the pane, so the question being
// answered right now is the first thing on screen — no scrolling down mid-
// interview. Everything older sits above it, one scroll up away.
// The trailing spacer gives the last card enough room below to actually reach
// the top of a pane that isn't full yet.
function paneSpacer(pane) {
  let sp = pane.querySelector(':scope > .feed-spacer');
  if (!sp) {
    sp = document.createElement('div');
    sp.className = 'feed-spacer';
  }
  pane.appendChild(sp); // always the last child
  return sp;
}
function appendAtTop(pane, el) {
  pane.appendChild(el);
  // Un-zen first: a hidden pane measures 0 and the scroll below would no-op.
  updateClearVisibility();
  const sp = paneSpacer(pane);
  sp.style.height = '0px';
  const room = pane.clientHeight - el.offsetHeight - 12;
  sp.style.height = room > 0 ? `${room}px` : '0px';
  pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
}

function hasSessionContent() {
  return Boolean(
    transcriptPane.querySelector('.line') ||
    suggestionsPane.querySelector('.suggestion, .qa-card') ||
    !answerStage.classList.contains('hidden')
  );
}

function updateClearVisibility() {
  const has = hasSessionContent();
  clearBtn.style.display = has ? '' : 'none';
  // "End session" is only meaningful once something has been said. While live the
  // action bar is crowded, so it shortens to "End".
  endBtn.style.display = has ? '' : 'none';
  endBtn.querySelector('span').textContent = isCapturing ? 'End' : 'End session';
  // Zen idle: no content and not live → hide the empty furniture entirely.
  appEl.classList.toggle('zen', !has && !isCapturing);
}

function resetSessionUi() {
  transcriptPane.innerHTML = '';
  transcriptPane.appendChild(transcriptEmpty);
  transcriptEmpty.style.display = '';
  suggestionsPane.innerHTML = '';
  suggestionsPane.appendChild(suggestionsEmpty);
  suggestionsEmpty.style.display = '';
  stageReset();
  answerStage.classList.add('hidden');
  tickerText.textContent = 'Listening…';
  updateClearVisibility();
}

// ── Transcript ──
// No "[Them]"/"[You]" labels — in a live call that's noise. The speaker is
// carried by the coloured rail on the left instead, so the eye reads words.
function appendTranscriptLine({ source, text, isQuestion, readBack }) {
  transcriptEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.className = `line ${source}${isQuestion ? ' q' : ''}${readBack ? ' readback' : ''}`;
  const rbNote = readBack ? '<span class="rb-note">(you, reading)</span>' : '';
  div.innerHTML = `${escapeHtml(text)}${rbNote}`;
  pinnedAppend(transcriptPane, div);
  tickerText.textContent = text;
  updateClearVisibility();
}

// ── Suggestions feed ──
function appendSuggestion({ text, kind }) {
  suggestionsEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.className = `suggestion ${kind || ''}`;
  const label = kind === 'help' ? 'Answer' : kind === 'recap' ? 'Recap' : '';
  const tag = label ? `<div class="s-time"><span class="s-tag">${label}</span></div>` : '';
  div.innerHTML = `${tag}${escapeHtml(text)}`;
  appendAtTop(suggestionsPane, div);
  updateClearVisibility();
  return div;
}

// The labels our prompt asks for — used to recover structure when a weaker
// model jams everything onto one line instead of using clean LABEL/SAY lines.
const KNOWN_LABELS = 'Say this|My role|Stronger version|Short human explanation|Add this stronger line|If they ask your role|If they push deeper|If pushed|If they probe|Then your role|A more polished version';

function splitInline(text, labelRe) {
  const matches = [...text.matchAll(labelRe)];
  if (matches.length < 2) return null;
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const line = text.slice(start, end).trim().replace(/^["']|["']$/g, '').trim();
    if (line) out.push({ cue: matches[i][1].trim(), line });
  }
  return out.length >= 2 ? out : null;
}

function parseBeats(text) {
  const beats = [];
  let cue = null;
  for (const raw of text.split(/\r?\n/)) {
    const c = raw.match(/^\s*(?:CUE|LABEL):\s*(.+)$/i);
    const l = raw.match(/^\s*(?:LINE|SAY):\s*(.+)$/i);
    if (c) cue = c[1].trim();
    else if (l && cue) { beats.push({ cue, line: l[1].trim() }); cue = null; }
  }
  if (beats.length) return beats;
  // Inline fallbacks, most reliable first: our known labels, the same labels
  // sitting on their own line WITHOUT the colon (weak models drop the "LABEL:"
  // scaffolding but keep the label words — observed live on llama-3.1-8b), then
  // any short Title-Case label + colon.
  return (
    splitInline(text, new RegExp(`(${KNOWN_LABELS}):\\s*`, 'gi')) ||
    splitInline(text, new RegExp(`(?:^|\\n)[ \\t]*(${KNOWN_LABELS})[ \\t]*:?[ \\t]*(?:\\r?\\n|$)`, 'gi')) ||
    // Worst case seen live: the whole answer on ONE physical line, labels and
    // all. Only split where a label starts a sentence AND the next word is
    // capitalised — otherwise ordinary prose ("my role was to lead the fix")
    // would be torn in half at its own words.
    splitInline(text, new RegExp(`(?:^|(?<=[.!?])\\s+)(${KNOWN_LABELS})\\s+(?=[A-Z])`, 'g')) ||
    splitInline(text, /(?:^|[\s.,!?"])([A-Z][A-Za-z'’ -]{2,34}?):\s+/g)
  );
}
// Cluely-style bullets: a short label, then the exact words to speak in bold.
function ansBlocksHtml(blocks) {
  return blocks
    .map((b) => `<div class="ans-block"><span class="ab-label">${escapeHtml(b.cue)}</span><span class="ab-say">${escapeHtml(b.line)}</span></div>`)
    .join('');
}
function substanceOf(text) {
  const beats = parseBeats(text);
  return beats ? beats.map((b) => b.line).join(' ') : text;
}
// DSA / System-Design answers are a rough scratchpad + fenced code, not speakable
// bullets. Render prose lines as-is and each ```code``` block as a monospace <pre>
// with a Copy button (so the candidate can paste it straight into the editor).
function renderCodeAnswer(text) {
  const clean = stripNote(text).replace(/^\s*-\s*$/, '').trim();
  const re = /```(\w*)\r?\n?([\s\S]*?)```/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) parts.push({ type: 'text', v: clean.slice(last, m.index) });
    parts.push({ type: 'code', lang: m[1] || '', v: m[2].replace(/\s+$/, '') });
    last = re.lastIndex;
  }
  if (last < clean.length) parts.push({ type: 'text', v: clean.slice(last) });
  if (!parts.length) parts.push({ type: 'text', v: clean });
  return parts
    .map((p) => {
      if (p.type === 'code') {
        const lang = p.lang ? `<span class="code-lang">${escapeHtml(p.lang)}</span>` : '';
        return `<div class="ans-code-wrap">${lang}<button class="code-copy" title="Copy code">Copy</button><pre class="ans-code"><code>${escapeHtml(p.v)}</code></pre></div>`;
      }
      const t = p.v.trim();
      return t ? `<div class="ans-scratch">${escapeHtml(t).replace(/\n/g, '<br>')}</div>` : '';
    })
    .join('');
}
function wireCopyButtons(container) {
  container.querySelectorAll('.code-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pre = btn.parentElement.querySelector('pre');
      const code = pre ? pre.innerText : '';
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
      }).catch(() => {});
    });
  });
}
function isCodeAnswer(text, format) {
  return format === 'code' || /```/.test(text || '');
}
// The optional "NOTE:" line is the silent mis-hearing correction — shown to the
// user as a small chip, never part of what they say aloud. Non-greedy: stop at
// the first block label so it never swallows the answer when a model puts NOTE
// and the blocks on one line.
const NOTE_RE = new RegExp(
  `NOTE:\\s*(answering about\\s+[^\\n]+?)(?=\\s+(?:${KNOWN_LABELS}|LABEL|SAY|CUE|LINE)\\b|[\\r\\n]|$)`,
  'i'
);
function extractNote(text) {
  const m = text.match(NOTE_RE);
  return m ? m[1].trim() : null;
}
function stripNote(text) {
  return text.replace(NOTE_RE, '').replace(/^\s*NOTE:.*$/im, '').trim();
}
// Turn any answer text into non-empty blocks — never render a blank answer.
function toBlocks(text) {
  const body = stripNote(text);
  let blocks = parseBeats(body) || parseBeats(text);
  if (blocks) blocks = blocks.filter((b) => b.line && b.line.trim());
  if (!blocks || !blocks.length) {
    const fallback = (body || text).replace(/^\s*(?:LABEL|SAY|CUE|LINE|NOTE):\s*/i, '').trim();
    blocks = [{ cue: 'Say this', line: fallback }];
  }
  return blocks;
}
function parseUpNext(text) {
  const q = text.match(/^\s*Q:\s*(.+)$/im);
  const a = text.match(/^\s*A:\s*([\s\S]+)$/im);
  if (q && a) return { q: q[1].trim(), a: a[1].trim() };
  return null;
}

// ── Answer Stage ──
function stageReset() {
  stageQ.textContent = '';
  stageQ.classList.remove('listening');
  stageModel.className = 'stage-model hidden';
  stageNote.textContent = '';
  stageNote.classList.add('hidden');
  stageAnswer.innerHTML = '';
  stageAnswer.classList.remove('thinking');
  stageUpnext.classList.add('hidden');
  stageUpnext.innerHTML = '';
  stageUpBtn.classList.add('hidden');
  stageUpBtn.classList.remove('open');
  stageDiff.classList.add('hidden');
  stageUpsellHint.classList.add('hidden');
  stageMeta.textContent = '';
}
function stageShow() {
  if (plan !== 'pro') return;
  if (answerStage.classList.contains('hidden')) {
    answerStage.classList.remove('hidden');
    if (!localStorage.getItem('confero.dockTipDismissed')) dockTip.classList.remove('hidden');
    updateClearVisibility();
  }
}
dockTipClose.addEventListener('click', () => {
  dockTip.classList.add('hidden');
  localStorage.setItem('confero.dockTipDismissed', '1');
});

// ── Pipeline events ──
window.stealthAPI.onAnswerListening(({ question }) => {
  if (plan !== 'pro') return;
  stageShow();
  stageQ.textContent = question || '';
  stageQ.classList.add('listening'); // still hearing them out — settle window running
});

window.stealthAPI.onAnswerPending(({ question }) => {
  if (plan === 'pro') {
    stageShow();
    stageReset();
    stageQ.textContent = question || '';
    stageAnswer.textContent = 'Thinking…';
    stageAnswer.classList.add('thinking');
  }
  currentFeedCard = null;
});

// "Answer now" with an empty transcript: there's nothing to answer, so the main
// process replies with a status line instead of an answer. It's not something to
// say aloud — surface it as a banner and release the button.
window.stealthAPI.onAnswerQuick(({ text }) => {
  resetHelpBtn();
  showNote(text);
});

// One consistent structured answer (was two racing calls). Parses the optional
// correction NOTE (shown as a chip, never spoken) + the labeled blocks, and
// renders them as Cluely-style bullets with the spoken words in bold.
function renderAnswer({ question, text, ms, adaptiveUpsell, provider, detail, format, origin }) {
  // An ask-bar turn is MY question, not theirs — chip it so the scrollback
  // doesn't later read as if the interviewer asked "in bullet points".
  const typedChip = origin === 'typed' ? '<span class="qa-typed">You asked</span>' : '';
  resetHelpBtn();
  // Panel hidden: the answer still renders into the (hidden) pane, so all that's
  // needed is a dot on Ask saying there's something waiting behind it.
  if (uiHidden) hbToggle.classList.add('has-news');
  const note = extractNote(text);
  const codeMode = isCodeAnswer(text, format);
  const blocks = codeMode ? null : toBlocks(text);
  const answerHtml = codeMode ? renderCodeAnswer(text) : ansBlocksHtml(blocks);
  lastAnswerSubstance = codeMode ? stripNote(text).trim() : blocks.map((b) => b.line).join(' ');
  // "which model" indicator (testing only): a colour-coded chip in the sticky
  // top row + the latency in the foot. e.g. chip "Gemini · flash · key 3/15".
  if (SHOW_MODEL_BADGE && provider) {
    stageModel.textContent = [provider, detail].filter(Boolean).join(' · ');
    stageModel.className = `stage-model m-${String(provider).toLowerCase()}`;
  } else {
    stageModel.className = 'stage-model hidden';
  }
  const stamp = ms ? `${(ms / 1000).toFixed(1)}s` : '';

  if (plan === 'pro') {
    stageShow();
    stageQ.classList.remove('listening');
    stageQ.innerHTML = `${typedChip}${escapeHtml(question || '')}`;
    if (note) { stageNote.textContent = `🎯 ${note}`; stageNote.classList.remove('hidden'); }
    else stageNote.classList.add('hidden');
    stageAnswer.classList.remove('thinking');
    stageAnswer.innerHTML = answerHtml;
    stageMeta.textContent = stamp;
    if (codeMode) {
      // Code answers: no "say it differently" (rephrasing code is nonsense), and
      // wire the Copy buttons so the solution goes straight into the editor.
      wireCopyButtons(stageAnswer);
      stageDiff.classList.add('hidden');
    } else {
      stageDiff.classList.remove('hidden');
      stageDiff.disabled = false;
      if (adaptiveUpsell) stageUpsellHint.classList.remove('hidden');
      // Compact history copy so scrollback survives the next question.
      const hist = appendSuggestion({ text: lastAnswerSubstance, kind: 'help' });
      attachDiffButton(hist, lastAnswerSubstance);
    }
  } else {
    // The candidate's reading surface: question in bold, answer straight under
    // it, nothing else competing for the eye. The card is pulled to the top of
    // the pane so the CURRENT question is what you see — the previous ones are
    // above, only if you scroll back for them.
    suggestionsEmpty.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'qa-card';
    const qLine = question ? `<div class="qa-q">${typedChip}${escapeHtml(question)}</div>` : '';
    const noteLine = note ? `<div class="qa-note">🎯 ${escapeHtml(note)}</div>` : '';
    card.innerHTML = `${qLine}${noteLine}<div class="ans-list">${answerHtml}</div>`;
    const foot = document.createElement('div');
    foot.className = 'qa-foot';
    card.appendChild(foot);
    if (codeMode) wireCopyButtons(card);
    else attachDiffButton(card, lastAnswerSubstance, foot);
    if (adaptiveUpsell) {
      const hint = document.createElement('span');
      hint.className = 'qa-upsell';
      hint.textContent = 'Follow-up-aware answers are Premium →';
      hint.addEventListener('click', () => openUpsell('Interviewers never ask just one question. Premium keeps up with every follow-up.'));
      foot.appendChild(hint);
    }
    const metaBits = [SHOW_MODEL_BADGE && provider ? [provider, detail].filter(Boolean).join(' · ') : '', stamp].filter(Boolean);
    if (metaBits.length) {
      const meta = document.createElement('span');
      meta.className = 'qa-meta';
      meta.textContent = metaBits.join(' · ');
      foot.appendChild(meta);
    }
    // Mark the live card explicitly. `:last-of-type` can't do this job — the
    // trailing .feed-spacer is a div too, so no .qa-card is ever the last div of
    // its type and the rule silently never matched.
    suggestionsPane.querySelectorAll('.qa-card.current').forEach((c) => c.classList.remove('current'));
    card.classList.add('current');
    appendAtTop(suggestionsPane, card);
    currentFeedCard = card;
  }
  updateClearVisibility();
}
window.stealthAPI.onAnswerReady(renderAnswer);

// Up next (the likely follow-up question) is now PARKED BEHIND A BUTTON instead
// of printing itself under the answer. Unasked-for, it was a second block of text
// arriving next to the words the candidate is trying to read off — guessing at a
// question that may never be asked. As a button it costs nothing until wanted.
function mountUpNext(card, html) {
  const foot = card.querySelector('.qa-foot');
  if (!foot) return;
  let panel = card.querySelector('.upnext-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'stage-upnext upnext-panel hidden';
    card.appendChild(panel);
  }
  panel.innerHTML = html;
  if (foot.querySelector('.card-upnext')) return; // content refreshed, button already there
  const btn = document.createElement('button');
  btn.className = 'card-upnext';
  btn.textContent = '⤳ Up next';
  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('hidden') === false;
    btn.classList.toggle('open', open);
  });
  // Directly after "Say it differently" — to its RIGHT — and before the meta,
  // which floats itself to the far end of the row with margin-left:auto.
  const diff = foot.querySelector('.card-diff');
  foot.insertBefore(btn, diff ? diff.nextSibling : foot.firstChild);
}

window.stealthAPI.onAnswerUpNext(({ text }) => {
  const parsed = parseUpNext(text);
  const inner = parsed
    ? `<span class="un-tag">Up next</span><b>${escapeHtml(parsed.q)}</b><br>${escapeHtml(parsed.a)}`
    : `<span class="un-tag">Up next</span>${escapeHtml(text)}`;
  if (plan === 'pro') {
    stageUpnext.innerHTML = inner;
    stageUpnext.classList.add('hidden'); // stays shut until the button is pressed
    stageUpBtn.classList.remove('hidden');
    stageUpBtn.classList.remove('open');
  } else if (currentFeedCard) {
    mountUpNext(currentFeedCard, inner);
  }
});

// ── Say it differently ──
async function requestRephrase(sourceText, renderTake2) {
  const res = await window.stealthAPI.rephrase(sourceText);
  if (res.upsell) {
    openUpsell("You've used this session's free rephrase. Pro rewords any answer, any number of times.");
    return null;
  }
  if (res.error) { showError(res.error); return null; }
  renderTake2(res.text);
  return res.text;
}
stageUpBtn.addEventListener('click', () => {
  const open = stageUpnext.classList.toggle('hidden') === false;
  stageUpBtn.classList.toggle('open', open);
});
stageDiff.addEventListener('click', async () => {
  if (!lastAnswerSubstance) return;
  stageDiff.disabled = true;
  stageDiff.textContent = 'Rewording…';
  const out = await requestRephrase(lastAnswerSubstance, (text) => {
    stageAnswer.innerHTML = ansBlocksHtml([{ cue: 'Take 2', line: text }]);
  });
  if (out) lastAnswerSubstance = out;
  stageDiff.disabled = false;
  stageDiff.textContent = '↻ Differently';
});
// `mountEl` is where the button lives (a card foot row); the Take-2 text always
// lands in the card body itself.
function attachDiffButton(card, sourceText, mountEl) {
  const btn = document.createElement('button');
  btn.className = 'card-diff';
  btn.textContent = '↻ Say it differently';
  let source = sourceText;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const out = await requestRephrase(source, (text) => {
      const t2 = document.createElement('div');
      t2.className = 'take2';
      t2.innerHTML = `<span class="t2-tag">Take 2</span>${escapeHtml(text)}`;
      card.appendChild(t2);
    });
    if (out) source = out;
    btn.disabled = false;
  });
  (mountEl || card).appendChild(btn);
}

// ── Upsell ──
function openUpsell(message) {
  upsellMsg.textContent = message;
  upsellModal.classList.remove('hidden');
}
upsellClose.addEventListener('click', () => upsellModal.classList.add('hidden'));
stageUpsellHint.addEventListener('click', () =>
  openUpsell('Interviewers never ask just one question. Premium keeps up with every follow-up.')
);

// ── Upgrade to Premium (Stripe checkout in the browser) ──
// The pill only shows for free users; once premium, it hides.
function updateUpgradeUi() {
  if (!upgradeBtn) return;
  upgradeBtn.classList.toggle('hidden', plan === 'premium');
}
let upgrading = false;
async function startUpgrade() {
  if (upgrading) return;
  upgrading = true;
  if (upgradeBtn) { upgradeBtn.classList.add('busy'); upgradeBtn.textContent = 'Opening…'; }
  try {
    const res = await window.stealthAPI.startUpgrade();
    if (res && res.error) {
      openUpsell(res.error);
    } else {
      // Checkout opened in the browser. Main polls /api/me and pushes account:plan
      // when payment lands, which re-renders everything via applyPlan.
      openUpsell('Complete your upgrade in the browser tab that just opened. Premium unlocks here automatically once payment goes through.');
    }
  } catch (err) {
    openUpsell(err.message || 'Could not start the upgrade. Please try again.');
  } finally {
    upgrading = false;
    if (upgradeBtn) { upgradeBtn.classList.remove('busy'); upgradeBtn.textContent = '✦ Upgrade'; }
  }
}
if (upgradeBtn) upgradeBtn.addEventListener('click', startUpgrade);
updateUpgradeUi();

// ── Mock-interview consent (practice yes, live interview no) ──
let consentNext = null;
function openConsent(next) {
  consentNext = next;
  consentAsk.classList.remove('hidden');
  consentWarning.classList.add('hidden');
  consentModal.classList.remove('hidden');
}
consentPractice.addEventListener('click', () => {
  consentedThisRun = true;
  consentModal.classList.add('hidden');
  const next = consentNext;
  consentNext = null;
  if (next) next();
});
consentLive.addEventListener('click', () => {
  consentAsk.classList.add('hidden');
  consentWarning.classList.remove('hidden');
});
consentExit.addEventListener('click', () => window.stealthAPI.closeApp());
const needsConsent = () => activeModeId === 'interview' && !consentedThisRun;

// ── First-run Ethical Use Agreement ──
// Must be accepted (checkbox ticked) before the app is usable. Acceptance is
// persisted and versioned — bump AGREEMENT_VERSION to force re-acceptance if the
// terms materially change. The modal starts visible in the HTML so there's no
// flash of the app behind it; we dismiss it here if it was already accepted.
(function initAgreementGate() {
  const AGREEMENT_VERSION = '1';
  const KEY = 'confero.agreementAccepted';
  const gate = document.getElementById('agreementGate');
  const checkbox = document.getElementById('agreementCheckbox');
  const acceptBtn = document.getElementById('agreementAccept');
  const declineBtn = document.getElementById('agreementDecline');
  if (!gate) return;

  let accepted = false;
  try { accepted = localStorage.getItem(KEY) === AGREEMENT_VERSION; } catch (e) {}
  // Deferred: startLaunchFlow awaits `modesReady`, declared further down this
  // file — let the module finish evaluating before it runs.
  if (accepted) { gate.classList.add('hidden'); queueMicrotask(startLaunchFlow); return; }

  checkbox.addEventListener('change', () => { acceptBtn.disabled = !checkbox.checked; });
  acceptBtn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    try { localStorage.setItem(KEY, AGREEMENT_VERSION); } catch (e) {}
    gate.classList.add('hidden');
    startLaunchFlow();
  });
  declineBtn.addEventListener('click', () => window.stealthAPI.closeApp());
})();

// ── Init ──
window.stealthAPI.getConfig().then((cfg) => {
  titleEl.textContent = cfg.productName;
  if (cfg.stealthHotkey) {
    shareHotkeyLabel = String(cfg.stealthHotkey).replace('CommandOrControl', 'Ctrl');
    renderShareHide();
  }
});
// The plan drives layout, not just copy: the answer stage is Pro-only, so focus
// mode needs to know which pane is the primary object. Mirror it onto <div id=app>.
function applyPlan(p) {
  plan = p || 'free';
  const isPremium = plan === 'premium';
  appEl.classList.toggle('free', !isPremium);
  // Re-render the mode menu so premium cards lock/unlock, and reflect the plan on
  // the upgrade button, whenever the plan changes (e.g. after a successful upgrade).
  if (Array.isArray(modes) && modes.length) renderModeMenu(activeModeId);
  // The launch purpose picker locks premium cards too — re-render it if it's up
  // when the plan lands (or flips after an upgrade).
  if (typeof renderPurposeList === 'function' && purposeGate && !purposeGate.classList.contains('hidden')) renderPurposeList();
  if (typeof updateUpgradeUi === 'function') updateUpgradeUi();
}
applyPlan(plan); // paint the free layout until the backend says otherwise
window.stealthAPI.getAccount().then(({ plan: p }) => applyPlan(p)).catch(() => {});
window.stealthAPI.onPlanChanged(({ plan: p }) => applyPlan(p));

// ── Modes + session gate ──
const CONTEXT_PLACEHOLDERS = {
  interview: "Paste the job title + description, or describe the role you're practicing for.",
  tutoring: "What's this lesson covering? e.g. topic, student's level.",
  professional: "What's this meeting about? e.g. client, agenda, goal.",
  general: "What's this session about?",
};
const GATE_SUBS = {
  interview: '30 seconds here makes every answer match this exact role.',
  tutoring: 'Tell Confero what today is about so its nudges fit the lesson.',
  professional: 'Ground Confero in this meeting so suggestions hit the mark.',
  general: 'A little context makes every suggestion sharper.',
};

let gateForStart = false;
async function openGate(modeId, { forStart = false } = {}) {
  gateForStart = forStart;
  const m = modes.find((x) => x.id === modeId);
  const settings = await window.stealthAPI.getUserSettings();
  gateTitle.textContent = m ? `${m.emoji} ${m.label} Session` : 'Set up this Session';
  gateSub.textContent = GATE_SUBS[modeId] || GATE_SUBS.general;
  gateContext.placeholder = CONTEXT_PLACEHOLDERS[modeId] || CONTEXT_PLACEHOLDERS.general;
  gateContext.value = (settings.modeContext && settings.modeContext[modeId]) || '';
  if (gateVocab) gateVocab.value = settings.vocabularyHints || '';
  gateSave.disabled = gateContext.value.trim().length === 0;
  setGateDoc(settings.documentContext && settings.documentContext[modeId]);
  // Surface stale global setup (saved custom instructions / vocab hints) so it
  // can be wiped — this is what silently contaminated a different persona.
  const hasSaved = Boolean(settings.generatedSystemPrompt || settings.rawInstructions || settings.vocabularyHints);
  gateClearSaved.classList.toggle('hidden', !hasSaved);
  sessionGate.classList.remove('hidden');
  gateContext.focus();
}
function setGateDoc(doc) {
  gateDocName.textContent = doc ? doc.fileName : 'No document attached';
  gateDocName.classList.toggle('has-doc', Boolean(doc));
  gateDocRemove.classList.toggle('hidden', !doc);
  gateDocBtn.textContent = doc ? 'Replace' : 'Attach resume / doc';
}
gateContext.addEventListener('input', () => {
  gateSave.disabled = gateContext.value.trim().length === 0;
});
gateDocBtn.addEventListener('click', async () => {
  gateDocBtn.disabled = true;
  gateDocBtn.textContent = 'Reading…';
  try {
    const res = await window.stealthAPI.pickDocument();
    if (res && res.success) setGateDoc(res.documentContext);
    else if (res && res.error) showError(res.error);
  } finally {
    gateDocBtn.disabled = false;
    if (gateDocBtn.textContent === 'Reading…') gateDocBtn.textContent = 'Attach resume / doc';
  }
});
gateDocRemove.addEventListener('click', async () => {
  await window.stealthAPI.removeDocument();
  setGateDoc(null);
  showNote('Document removed.');
});
gateClearSaved.addEventListener('click', async () => {
  await window.stealthAPI.clearSavedAiSetup();
  gateClearSaved.classList.add('hidden');
  showNote('Cleared saved AI instructions & hints.');
});
async function persistGateVocab() {
  if (gateVocab) await window.stealthAPI.saveVocabularyHints(gateVocab.value.trim());
}
gateSave.addEventListener('click', async () => {
  await window.stealthAPI.saveModeContext(activeModeId, gateContext.value.trim());
  await persistGateVocab();
  sessionGate.classList.add('hidden');
  if (gateForStart) startListening();
});
gateSkip.addEventListener('click', async () => {
  // "Continue without context" still keeps any names typed for spelling.
  await persistGateVocab();
  sessionGate.classList.add('hidden');
  if (gateForStart) startListening();
});
// Close (✕) just dismisses the setup — never starts a session.
gateClose.addEventListener('click', () => {
  sessionGate.classList.add('hidden');
  gateForStart = false;
});

function renderModeChip(id) {
  const m = modes.find((x) => x.id === id) || modes[0];
  if (!m) return;
  modeEmoji.textContent = m.emoji;
  modeLabel.textContent = m.label;
  updateCodeAssistBtn();
}
// Code Assist is a coding-round tool — only surface it for a code-format mode
// (currently DSA & System Design), so it never clutters a spoken interview.
function updateCodeAssistBtn() {
  const m = modes.find((x) => x.id === activeModeId);
  const isCode = Boolean(m && m.answerFormat === 'code');
  codeAssistBtn.style.display = isCode ? '' : 'none';
}
function renderModeMenu(activeId) {
  const isPremium = plan === 'premium';
  modeItemsList.innerHTML = modes.map((m) => {
    const locked = m.premium && !isPremium;
    return `
    <div class="mode-item ${m.id === activeId ? 'active' : ''} ${locked ? 'locked' : ''}" data-id="${m.id}" data-locked="${locked ? '1' : ''}">
      <span class="mi-emoji">${m.emoji}</span>
      <div><div class="mi-label">${escapeHtml(m.label)}${locked ? ' <span class="mi-lock">🔒 Premium</span>' : ''}</div><div class="mi-blurb">${escapeHtml(m.blurb)}</div></div>
    </div>`;
  }).join('');
  modeItemsList.querySelectorAll('.mode-item').forEach((el) => {
    el.addEventListener('click', async () => {
      // A locked premium card doesn't switch modes — it opens the upgrade flow.
      if (el.getAttribute('data-locked')) {
        modeMenu.classList.add('hidden');
        startUpgrade();
        return;
      }
      const id = el.getAttribute('data-id');
      await window.stealthAPI.setActiveMode(id);
      activeModeId = id;
      renderModeChip(id);
      renderModeMenu(id);
      modeMenu.classList.add('hidden');
      if (needsConsent()) openConsent(() => openGate(id));
      else openGate(id);
    });
  });
}
async function initModes() {
  modes = await window.stealthAPI.listModes();
  activeModeId = await window.stealthAPI.getActiveMode();
  renderModeChip(activeModeId);
  renderModeMenu(activeModeId);
}
const modesReady = initModes();

// ── Launch flow: purpose (required) → personal context (skippable) ──
// Every launch starts by asking what this session is FOR, because the persona
// behind every answer hangs off it — a wrong mode is a wrong answer, and the
// old flow silently inherited whatever was picked last time. Purpose is
// mandatory (no ✕, no skip); the context step right after it is optional.
function renderPurposeList() {
  if (!purposeList) return;
  const isPremium = plan === 'premium';
  purposeList.innerHTML = modes.map((m) => {
    const locked = m.premium && !isPremium;
    return `
      <button class="purpose-card ${locked ? 'locked' : ''}" data-id="${m.id}" data-locked="${locked ? '1' : ''}">
        <span class="pc-emoji">${m.emoji}</span>
        <span class="pc-text">
          <span class="pc-label">${escapeHtml(m.label)}${locked ? ' <span class="mi-lock">🔒 Premium</span>' : ''}</span>
          <span class="pc-blurb">${escapeHtml(m.blurb)}</span>
        </span>
      </button>`;
  }).join('');
  purposeList.querySelectorAll('.purpose-card').forEach((el) => {
    el.addEventListener('click', () => {
      // A locked card can't be the purpose — it opens the upgrade flow and
      // leaves this gate up, so the user still has to choose something.
      if (el.getAttribute('data-locked')) { startUpgrade(); return; }
      choosePurpose(el.getAttribute('data-id'));
    });
  });
}

async function choosePurpose(id) {
  await window.stealthAPI.setActiveMode(id);
  activeModeId = id;
  renderModeChip(id);
  renderModeMenu(id);
  purposeGate.classList.add('hidden');
  // Step 2 — who you are / what this is about. Skippable: the gate's
  // "Continue without context" and ✕ both just close it.
  if (needsConsent()) openConsent(() => openGate(id));
  else openGate(id);
}

let launchFlowStarted = false;
async function startLaunchFlow() {
  if (launchFlowStarted || !purposeGate) return;
  launchFlowStarted = true;
  await modesReady;
  renderPurposeList();
  purposeGate.classList.remove('hidden');
}

modeContextEdit.addEventListener('click', () => {
  modeMenu.classList.add('hidden');
  openGate(activeModeId);
});
modeChip.addEventListener('click', (e) => { e.stopPropagation(); modeMenu.classList.toggle('hidden'); });
document.addEventListener('click', () => modeMenu.classList.add('hidden'));
modeMenu.addEventListener('click', (e) => e.stopPropagation());

// ── Past sessions ──
function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
async function openSessions() {
  sessionViewer.classList.add('hidden');
  sessionsBack.classList.add('hidden');
  sessionTools.classList.add('hidden');
  sessionsList.style.display = '';
  const sessions = await window.stealthAPI.listSessions();
  sessionsList.innerHTML = sessions.length
    ? sessions.map((s) => `
        <button class="session-item" data-id="${s.id}">
          <span class="si-name">${escapeHtml(s.name)}</span>
          <span class="si-meta">${fmtDate(s.savedAt)} · ${s.lines} lines${s.hasSummary ? ' · summary' : ''}</span>
        </button>`).join('')
    : '<div class="sessions-empty">No saved sessions yet — finish one and start another, and it lands here automatically.</div>';
  sessionsList.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', () => viewSession(el.getAttribute('data-id')));
  });
  sessionsModal.classList.remove('hidden');
}
// Plain-text transcript of a SAVED session, for the clipboard. Elapsed stamps,
// same shape as the live end-of-session report.
function plainTranscript(session) {
  const lines = session.transcript || [];
  if (!lines.length) return '';
  const t0 = lines[0].timestamp;
  const stamp = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    const h = Math.floor(total / 3600);
    const body = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    return h ? `${h}:${body}` : body;
  };
  const head = `${session.name}\n${fmtDate(session.savedAt)} · ${lines.length} lines\n${'─'.repeat(48)}`;
  const body = lines
    .map((t) => `[${stamp(t.timestamp - t0)}] ${t.source === 'system' ? 'Them' : 'You'}: ${t.text.trim()}`)
    .join('\n');
  return `${head}\n${body}\n`;
}

let viewedSession = null;
async function viewSession(id) {
  const s = await window.stealthAPI.getSession(id);
  if (!s) return;
  if (s.summary) s.summary = normalizeSummary(s.summary); // same repair as the live report
  viewedSession = s;
  const parts = [];
  if (s.summary) parts.push(`<span class="sv-summary">${summaryHtml(s.summary)}</span>`);
  for (const t of s.transcript || []) {
    parts.push(`<div>[${t.source === 'system' ? 'Them' : 'You'}] ${escapeHtml(t.text)}</div>`);
  }
  for (const a of s.answers || []) {
    if (a.kind === 'answer') {
      parts.push(`<br><div class="sv-q">Q: ${escapeHtml(a.question || '')}</div><div class="sv-a">${escapeHtml(substanceOf(a.text))}</div>`);
    }
  }
  sessionViewer.innerHTML = parts.join('') || 'Empty session.';
  sessionsList.style.display = 'none';
  sessionViewer.classList.remove('hidden');
  sessionsBack.classList.remove('hidden');
  sessionTools.classList.remove('hidden');
  svCopySummary.disabled = !s.summary;
  svCopySummary.title = s.summary ? 'Copy this session\'s summary' : 'This session was saved without a summary';
}
sessionTools.addEventListener('click', (e) => e.stopPropagation());
// Same full-screen document surface the live report uses — including Regenerate
// and "ask about this meeting", which work just as well a month later.
svOpenFull.addEventListener('click', async () => {
  if (!viewedSession) return;
  const res = await window.stealthAPI.openSessionReport(viewedSession.id);
  if (res && res.error) showError(res.error);
});
svCopySummary.addEventListener('click', () => {
  if (viewedSession && viewedSession.summary) copyWithFeedback(viewedSession.summary, svCopySummary);
});
svCopyTranscript.addEventListener('click', () => {
  if (viewedSession) copyWithFeedback(plainTranscript(viewedSession), svCopyTranscript);
});
historyBtn.addEventListener('click', openSessions);
sessionsClose.addEventListener('click', () => sessionsModal.classList.add('hidden'));
sessionsBack.addEventListener('click', () => {
  sessionViewer.classList.add('hidden');
  sessionsBack.classList.add('hidden');
  sessionTools.classList.add('hidden');
  sessionsList.style.display = '';
});

// ── Events from main ──
window.stealthAPI.onTranscriptChunk(appendTranscriptLine);
window.stealthAPI.onSuggestionUpdate((p) => appendSuggestion({ ...p }));
window.stealthAPI.onAppError(({ message }) => { resetHelpBtn(); showError(message); });
window.stealthAPI.onGuardrailBlocked(({ app }) => {
  guardrailMsg.textContent = `Proctoring software detected (${app}). Confero will not operate during a proctored exam.`;
  guardrailLock.classList.remove('hidden');
  if (isCapturing) { window.audioCapture.stopAudioCapture(); setCapturingUi(false); }
});
window.stealthAPI.onGuardrailCleared(() => guardrailLock.classList.add('hidden'));

// ── Hide from screen share ──
// The user-facing name for content protection. "Stealth" is what it is
// internally; nobody buying this app should have to know that word. Hidden is
// the default and the quiet state; visible is called out in amber, because
// being visible during a real call is the state you'd want to notice.
const shareHideBtn = document.getElementById('shareHideBtn');
let shareHidden = true;

// Read from config so an overridden STEALTH_HOTKEY doesn't leave the tooltip
// advertising a key that does nothing.
let shareHotkeyLabel = 'Alt+H';
function renderShareHide() {
  if (!shareHideBtn) return;
  shareHideBtn.classList.toggle('is-visible', !shareHidden);
  shareHideBtn.title = (shareHidden
    ? 'Hidden from screen share — click to let others see Confero'
    : 'Visible on screen share — click to hide Confero again')
    + ` (${shareHotkeyLabel})`;
}
// Say it in plain words at the moment it changes — this is the one setting where
// being wrong about the state is genuinely costly.
function announceShareState() {
  if (shareHidden) showNote("Confero is hidden — it won't appear when you share your screen.");
  else showError('Confero is now VISIBLE to anyone you share your screen with.');
}
// The Alt+H hotkey flips the same switch, so mirror whatever main reports — and
// banner it too: pressing a hotkey blind, you need the confirmation MORE than
// when you clicked the button and watched the icon change. `source` filters out
// the silent restore at startup, which would otherwise banner on every launch.
window.stealthAPI.onStealthStateChanged(({ enabled, source }) => {
  shareHidden = enabled;
  renderShareHide();
  if (source === 'hotkey') announceShareState();
});
window.stealthAPI.getStealthState().then(({ enabled }) => {
  shareHidden = enabled;
  renderShareHide();
}).catch(() => {});

if (shareHideBtn) {
  shareHideBtn.addEventListener('click', async () => {
    shareHideBtn.disabled = true;
    try {
      const res = await window.stealthAPI.setStealthEnabled(!shareHidden);
      shareHidden = res.enabled;
      renderShareHide();
      if (res.blocked) showError("Can't hide Confero while proctoring software is running.");
      else announceShareState();
    } catch (err) {
      showError(err.message || "Couldn't change that setting.");
    } finally {
      shareHideBtn.disabled = false;
    }
  });
}

// ── Capture controls ──
// Focus mode: while live, the stage owns the window; the ticker replaces the
// transcript; feeds return when the session stops (or on a ticker peek).

// ── Floating "Answer now" pill ──
// PERMANENT for the whole live session — it is not tied to whether an answer is
// currently on screen. Deliberate: its job is "answer the thing they just said",
// which is just as valid straight after an answer (they asked a follow-up, the
// question wasn't detected, the last answer missed the point). A button that
// comes and goes is one you have to look for, and mid-call there is no time to
// look. Shown on Start, hidden on Stop, nothing in between.
function measureBottomCluster() {
  // The pill hovers above whatever the topmost bottom control is. Measured, not
  // hardcoded: the ask bar can be hidden, and the action bar wraps to two rows in
  // code modes. (This used to measure the test-only model bar that sat here
  // before the ask bar replaced it — left unmeasured, the pill covers the ask box.)
  const askBar = document.getElementById('askBar');
  const first = askBar && !askBar.classList.contains('hidden')
    ? askBar
    : document.querySelector('.action-bar');
  if (!first) return;
  const px = Math.round(appEl.getBoundingClientRect().bottom - first.getBoundingClientRect().top);
  appEl.style.setProperty('--bottom-cluster', `${px}px`);
}
function setQuickAnswerVisible(show) {
  if (show) measureBottomCluster();
  quickAnswerRow.classList.toggle('hidden', !show);
}
window.addEventListener('resize', () => {
  if (!quickAnswerRow.classList.contains('hidden')) measureBottomCluster();
});

function setCapturingUi(capturing) {
  isCapturing = capturing;
  startBtn.style.display = capturing ? 'none' : '';
  activeActions.classList.toggle('hidden', !capturing);
  setQuickAnswerVisible(capturing); // stays up for the whole live session
  appEl.classList.toggle('focus', capturing);
  if (!capturing) appEl.classList.remove('peek');
  updateClearVisibility();
  if (window.__cwUpdateLive) window.__cwUpdateLive(); // Code Assist "● listening" badge
}
ticker.addEventListener('click', () => appEl.classList.toggle('peek'));

async function startListening() {
  startBtn.disabled = true;
  try {
    const res = await window.stealthAPI.startCapture();
    if (res && res.blocked) { showError(res.reason); return; }
    await window.audioCapture.startAudioCapture();
    setCapturingUi(true);
  } catch (err) {
    showError(`Couldn't start: ${err.message}`);
  } finally {
    startBtn.disabled = false;
  }
}

// Start flow: archive leftovers → mock-interview consent → context gate → go.
startBtn.addEventListener('click', async () => {
  if (hasSessionContent()) {
    const r = await window.stealthAPI.archiveAndResetSession();
    resetSessionUi();
    if (r && r.saved) showNote(`Previous session saved as "${r.saved.name}"`);
  }
  const proceed = async () => {
    const settings = await window.stealthAPI.getUserSettings();
    const hasContext = Boolean(settings.modeContext && (settings.modeContext[activeModeId] || '').trim());
    if (!hasContext) openGate(activeModeId, { forStart: true });
    else startListening();
  };
  if (needsConsent()) openConsent(proceed);
  else proceed();
});

stopBtn.addEventListener('click', async () => {
  window.audioCapture.stopAudioCapture();
  await window.stealthAPI.stopCapture();
  setCapturingUi(false);
});

// Answer now: the user's override — skip the settle window, answer immediately.
let helpBtnTimer = null;
function resetHelpBtn() {
  clearTimeout(helpBtnTimer);
  helpNowBtn.disabled = false;
  const span = helpNowBtn.querySelector('span');
  if (span) span.textContent = 'Answer now';
}
helpNowBtn.addEventListener('click', async () => {
  helpNowBtn.disabled = true;
  helpNowBtn.querySelector('span').textContent = 'Thinking…';
  helpBtnTimer = setTimeout(resetHelpBtn, 10000);
  try {
    await window.stealthAPI.helpNow();
  } catch (err) {
    resetHelpBtn();
    showError(err.message);
  }
});

recapBtn.addEventListener('click', async () => {
  recapBtn.disabled = true;
  try {
    const res = await window.stealthAPI.recap();
    if (res.error) showError(res.error);
    else appendSuggestion({ text: res.text, kind: 'recap' });
  } catch (err) { showError(err.message); }
  finally { recapBtn.disabled = false; }
});

clearBtn.addEventListener('click', async () => {
  resetSessionUi();
  await window.stealthAPI.clearTranscript();
});

closeBtn.addEventListener('click', () => window.stealthAPI.closeApp());

// ── Floating bar: Collapse ⇄ Expand ──
// Collapses the PANEL out of the candidate's own view and shrinks the window to
// the bar. Deliberately not a stop and not a close: capture, transcript and the
// question pipeline all keep running, so Expand brings back a live session, not
// a fresh one. (Separate from "hide from screen share", which is about what the
// OTHER people on the call can see.)
let uiHidden = false;
function setUiHidden(hidden) {
  uiHidden = Boolean(hidden);
  document.body.classList.toggle('collapsed', uiHidden);
  hbToggleLabel.textContent = uiHidden ? 'Expand' : 'Collapse';
  hbToggle.title = uiHidden
    ? 'Expand Confero back to the full panel'
    : 'Collapse Confero to this bar — the session keeps running';
  if (!uiHidden) hbToggle.classList.remove('has-news');
  window.stealthAPI.setOverlayCollapsed(uiHidden);
}
hbToggle.addEventListener('click', () => setUiHidden(!uiHidden));

// ── Draggable divider (idle/review layout) ──
(function initDivider() {
  const saved = Number(localStorage.getItem('confero.transcriptPx'));
  if (saved && saved >= 60) transcriptPane.style.flex = `0 0 ${saved}px`;
  let dragging = false;
  paneDivider.addEventListener('mousedown', (e) => {
    dragging = true;
    paneDivider.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const top = transcriptPane.getBoundingClientRect().top;
    const px = Math.max(60, Math.min(e.clientY - top, window.innerHeight - 220));
    transcriptPane.style.flex = `0 0 ${px}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    paneDivider.classList.remove('dragging');
    localStorage.setItem('confero.transcriptPx', String(Math.round(transcriptPane.getBoundingClientRect().height)));
  });
})();

// ── Answer display prefs (size + bold) ──
// Persisted, applied as CSS variables so they take effect instantly on the live
// answer and every feed card — independent of which model produced the text.
(function initAnswerPrefs() {
  const SIZE_KEY = 'confero.answerSize';
  const BOLD_KEY = 'confero.answerBold';
  const downBtn = document.getElementById('fontDownBtn');
  const upBtn = document.getElementById('fontUpBtn');
  const sizeLabel = document.getElementById('fontSizeLabel');
  const boldToggle = document.getElementById('boldToggle');
  const MIN = 12, MAX = 22, DEFAULT = 15;

  const getSize = () => {
    const s = Number(localStorage.getItem(SIZE_KEY));
    return s >= MIN && s <= MAX ? s : DEFAULT;
  };
  const isBold = () => localStorage.getItem(BOLD_KEY) !== '0'; // bold on by default

  function apply() {
    const size = getSize();
    const bold = isBold();
    document.documentElement.style.setProperty('--answer-size', `${size}px`);
    document.documentElement.style.setProperty('--answer-weight', bold ? '680' : '440');
    if (sizeLabel) sizeLabel.textContent = `${size}px`;
    if (boldToggle) boldToggle.checked = bold;
  }
  if (downBtn) downBtn.addEventListener('click', () => { localStorage.setItem(SIZE_KEY, Math.max(MIN, getSize() - 1)); apply(); });
  if (upBtn) upBtn.addEventListener('click', () => { localStorage.setItem(SIZE_KEY, Math.min(MAX, getSize() + 1)); apply(); });
  if (boldToggle) boldToggle.addEventListener('change', () => { localStorage.setItem(BOLD_KEY, boldToggle.checked ? '1' : '0'); apply(); });
  apply();
})();

// ── Ask bar: the typed lane into the answer pipeline ──────────────────────────
// Sits where the testing model picker used to. It covers the two things voice
// can't: asking something the other person never said, and reshaping the answer
// that's already on screen ("in bullet points", "shorter", "more technical").
// It goes through the SAME pipeline as a spoken question, so the result renders
// in the same place, in the same format — this is a second way in, not a second
// kind of answer.
const askInput = document.getElementById('askInput');
const askSend = document.getElementById('askSend');
if (askInput && askSend) {
  let askBusy = false;
  const syncAskBtn = () => { askSend.disabled = askBusy || !askInput.value.trim(); };

  async function submitAsk() {
    const text = askInput.value.trim();
    if (!text || askBusy) return;
    askBusy = true;
    syncAskBtn();
    askInput.disabled = true;
    // Clear immediately: the answer lands in the feed/stage, and a still-full box
    // reads as "it didn't send" while the model is thinking.
    askInput.value = '';
    try {
      const res = await window.stealthAPI.ask(text);
      if (res && res.error) {
        showError(res.error);
        askInput.value = text; // hand the text back rather than making them retype it
      }
    } catch (err) {
      showError(err.message);
      askInput.value = text;
    } finally {
      askBusy = false;
      askInput.disabled = false;
      syncAskBtn();
    }
  }

  askInput.addEventListener('input', syncAskBtn);
  askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAsk(); }
  });
  askSend.addEventListener('click', submitAsk);
  syncAskBtn();
}

updateClearVisibility();

// ── End of session: transcript + summary, both copyable ──
// The closing act: stop listening, then hand the user the two artifacts a call
// leaves behind — the full transcript, and a summary of what happened. Both are
// presented in the FULL-SCREEN report window, not in here: they're documents to
// read, copy and interrogate afterwards, and this overlay is a 380px strip built
// for glancing at mid-call. Main opens that window as soon as the transcript is
// assembled and fills the summary in when it lands, so all this has to do is ask.
let endBusy = false;

// Copy with in-place confirmation — a toast would be one more thing to read
// mid-flow, and the button is where the user is already looking.
function copyWithFeedback(text, btn, done = 'Copied ✓') {
  if (!text) return;
  const label = btn.querySelector('span') || btn;
  const original = label.textContent;
  navigator.clipboard.writeText(text).then(() => {
    label.textContent = done;
    setTimeout(() => { label.textContent = original; }, 1500);
  }).catch(() => showError("Couldn't copy to clipboard."));
}

// ── Summary rendering ──
// The shape-repair parser lives in summaryFormat.js — it's shared with the
// full-screen report window, which renders the same sections as real headings
// and lists. Here the summary is only ever a saved session's, shown in the
// past-sessions viewer.
// Every piece is a BLOCK and they're joined with nothing: the pane is
// white-space:pre-wrap for the transcript, so joining with "\n" would put a
// blank line on top of each block and double-space the whole summary.
const { normalizeSummary, parseSummary } = window.SummaryFormat;

function summaryHtml(text) {
  const out = [];
  for (const sec of parseSummary(text)) {
    if (sec.head) out.push(`<span class="eb-h">${escapeHtml(sec.head)}</span>`);
    for (const b of sec.blocks) {
      out.push(b.type === 'bullet'
        ? `<span class="eb-b">• ${escapeHtml(b.text)}</span>`
        : `<span class="eb-p">${escapeHtml(b.text)}</span>`);
    }
  }
  return out.join('');
}

// End = stop listening, then report. Stopping first means the summary covers the
// whole call and no late transcript chunk lands after it was written. The report
// itself opens in its OWN window (main does that as soon as the transcript is
// assembled), so all this waits for is the wrap-up to finish — and there's no
// longer any need to un-hide the panel first: the report is no longer a modal in
// here, so ending from the floating bar leaves the bar exactly as the user left it.
async function endSessionFlow() {
  if (endBusy) return;
  endBusy = true;
  const label = endBtn.querySelector('span');
  const original = label.textContent;
  label.textContent = 'Ending…';
  endBtn.disabled = true;
  hbEnd.disabled = true;
  try {
    if (isCapturing) {
      window.audioCapture.stopAudioCapture();
      await window.stealthAPI.stopCapture();
      setCapturingUi(false);
    }
    await window.stealthAPI.endSession();
  } catch (err) {
    showError(`Couldn't end the session: ${err.message}`);
  } finally {
    endBusy = false;
    endBtn.disabled = false;
    hbEnd.disabled = false;
    label.textContent = original;
  }
}
endBtn.addEventListener('click', endSessionFlow);
hbEnd.addEventListener('click', endSessionFlow);

// ── Code Assist workspace (DSA / LLD) ──
// A paste-driven coding surface layered over the app. The audio pipeline keeps
// running underneath, so a SPOKEN follow-up during the round ("walk me through
// the approach", "dry run it") streams into the same thread via `code:answer`.
(function initCodeWorkspace() {
  const ws = document.getElementById('codeWorkspace');
  const closeW = document.getElementById('cwClose');
  const liveBadge = document.getElementById('cwLive');
  const anchor = document.getElementById('cwAnchor');
  const anchorText = document.getElementById('cwAnchorText');
  const newProblem = document.getElementById('cwNewProblem');
  const newProblemBtn = document.getElementById('cwNewProblemBtn');
  const snipBtn = document.getElementById('cwSnipBtn');
  const thread = document.getElementById('cwThread');
  const emptyMsg = document.getElementById('cwEmpty');
  const chipsWrap = document.getElementById('cwChips');
  const chips = Array.from(chipsWrap.querySelectorAll('.cw-chip'));
  const input = document.getElementById('cwInput');
  const hint = document.getElementById('cwHint');
  const sendBtn = document.getElementById('cwSend');

  let anchored = false;      // has a problem been solved / pinned yet?
  let modifier = '';         // pre-anchor: the selected intent chip's instruction
  let busy = false;

  function updateLive() {
    liveBadge.classList.toggle('hidden', !isCapturing);
  }

  function reflectMode() {
    // Pre-anchor the composer is the paste box. Post-anchor it's a follow-up box —
    // but the "New problem" button stays visible so pasting the interviewer's NEXT
    // question and solving it fresh is one obvious click (not a hidden reset).
    input.placeholder = anchored
      ? 'Ask a follow-up (dry run, optimize…) — or paste the NEXT problem and hit “New problem”.'
      : 'Paste the DSA / LLD problem here…';
    sendBtn.querySelector('span').textContent = anchored ? 'Send' : 'Solve';
    newProblemBtn.style.display = anchored ? '' : 'none';
  }

  function renderAnswerInto(el, text) {
    // Reuse the exact code-answer renderer + Copy buttons the main stage uses.
    el.innerHTML = renderCodeAnswer(text);
    wireCopyButtons(el);
  }

  // Append a turn to the thread; returns the answer element so the caller fills
  // it once the reply lands (keeps the "Thinking…" placeholder visible meanwhile).
  function appendTurn(question, source) {
    if (emptyMsg) emptyMsg.style.display = 'none';
    const turn = document.createElement('div');
    turn.className = 'cw-turn';
    const srcTag = source === 'voice'
      ? '<span class="cw-src voice">Interviewer · spoken</span>'
      : '<span class="cw-src">You</span>';
    const q = document.createElement('div');
    q.className = 'cw-turn-q';
    q.innerHTML = `${srcTag}${escapeHtml(question)}`;
    const a = document.createElement('div');
    a.className = 'cw-turn-a';
    a.innerHTML = '<span class="cw-thinking">Thinking…</span>';
    turn.appendChild(q);
    turn.appendChild(a);
    thread.appendChild(turn);
    thread.scrollTop = thread.scrollHeight;
    return a;
  }

  function setAnchor(problemText) {
    anchored = true;
    anchorText.textContent = problemText;
    anchor.classList.remove('hidden');
    chips.forEach((c) => c.classList.remove('active'));
    modifier = '';
    reflectMode();
  }

  // A new problem is a fresh round — wipe the old thread so the pinned anchor and
  // the turns below it always describe the SAME problem.
  function clearThread() {
    thread.innerHTML = '';
    thread.appendChild(emptyMsg);
    emptyMsg.style.display = '';
  }

  function appendMeta(answerEl, res) {
    if (!res.ms) return;
    const meta = document.createElement('div');
    meta.className = 'cw-turn-meta';
    meta.textContent = `${(res.ms / 1000).toFixed(1)}s`;
    answerEl.parentElement.appendChild(meta);
    thread.scrollTop = thread.scrollHeight;
  }

  function chipLabel(instr) {
    const c = chips.find((x) => x.getAttribute('data-instruction') === instr);
    return c ? c.textContent : 'Solve';
  }

  async function solveInitial(problem) {
    clearThread(); // fresh problem → fresh thread
    const a = appendTurn(modifier ? chipLabel(modifier) : 'Initial solution', 'you');
    setAnchor(problem);
    input.value = '';
    const res = await window.stealthAPI.solveProblem(problem, modifier);
    if (res.error) { a.innerHTML = `<span class="cw-thinking">${escapeHtml(res.error)}</span>`; return; }
    renderAnswerInto(a, res.text);
    appendMeta(a, res);
  }

  async function solveFollowup(question) {
    const a = appendTurn(question, 'you');
    input.value = '';
    const res = await window.stealthAPI.codeFollowup(question);
    if (res.error) { a.innerHTML = `<span class="cw-thinking">${escapeHtml(res.error)}</span>`; return; }
    renderAnswerInto(a, res.text);
    appendMeta(a, res);
  }

  async function run(text) {
    if (busy) return;
    const val = (text != null ? text : input.value).trim();
    if (!anchored && !val) { hint.textContent = 'Paste the problem first.'; return; }
    busy = true; hint.textContent = ''; sendBtn.disabled = true;
    try {
      if (!anchored) await solveInitial(val);
      else await solveFollowup(val || 'Give the full working solution: approach, code, and complexity.');
    } catch (err) {
      hint.textContent = err.message || 'Something went wrong.';
    } finally {
      busy = false; sendBtn.disabled = false;
    }
  }

  // Chips: pre-anchor they pick the intent modifier for the initial solve;
  // post-anchor a tap fires that instruction as an immediate follow-up.
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const instr = chip.getAttribute('data-instruction');
      if (!anchored) {
        chips.forEach((c) => c.classList.toggle('active', c === chip));
        modifier = instr;
      } else {
        run(instr || 'Give the full working solution: approach, code, and complexity.');
      }
    });
  });

  sendBtn.addEventListener('click', () => run());
  // Ctrl/Cmd+Enter sends; plain Enter keeps a newline (problems are multi-line).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });

  // Switch problems. `solveInput=true` takes whatever is in the box and solves it
  // as a FRESH problem (re-anchor) — this is the fix for "I pasted the next
  // question but it kept answering the previous one". `solveInput=false` is a
  // plain reset back to the paste state.
  async function startNewProblem(solveInput) {
    const val = input.value.trim();
    anchored = false;
    anchor.classList.add('hidden');
    anchorText.textContent = '';
    chips.forEach((c) => c.classList.remove('active'));
    modifier = '';
    clearThread();
    newProblemBtn.classList.remove('attn');
    hint.textContent = '';
    await window.stealthAPI.clearActiveProblem();
    reflectMode();
    if (solveInput && val) {
      run(); // now !anchored + val → solveInitial(val), a clean code-first solve
    } else {
      input.value = '';
      input.focus();
    }
  }
  newProblem.addEventListener('click', () => startNewProblem(false));     // header: reset
  newProblemBtn.addEventListener('click', () => startNewProblem(true));   // composer: solve the paste

  // Snip → OCR: capture the problem off the screen (stealth) and drop the
  // extracted text into the box, EDITABLE — the candidate reviews it before
  // solving, so a misread constraint never gets acted on blind.
  snipBtn.addEventListener('click', async () => {
    if (snipBtn.disabled) return;
    const label = snipBtn.querySelector('span');
    const original = label.textContent;
    snipBtn.disabled = true;
    label.textContent = 'Snipping…';
    hint.textContent = '';
    try {
      const res = await window.stealthAPI.snipQuestion();
      if (res.cancelled) { /* user pressed Esc — no-op */ }
      else if (res.error) { hint.textContent = res.error; }
      else if (res.text) {
        input.value = res.text;
        input.dispatchEvent(new Event('input')); // fires the new-problem nudge if anchored
        input.focus();
        hint.textContent = anchored
          ? 'Extracted — edit if needed, then “New problem” to solve it.'
          : 'Extracted from screen — edit if needed, then Solve.';
      } else {
        hint.textContent = 'Nothing readable in that region.';
      }
    } catch (err) {
      hint.textContent = err.message || 'Snip failed.';
    } finally {
      snipBtn.disabled = false;
      label.textContent = original;
    }
  });

  // Nudge: while anchored, a long / multi-line paste is almost always the NEXT
  // problem, not a follow-up — surface the switch instead of letting it silently
  // become a follow-up to the old problem.
  input.addEventListener('input', () => {
    if (!anchored) return;
    const v = input.value;
    const looksNew = v.trim().length > 140 || v.split('\n').length > 3;
    newProblemBtn.classList.toggle('attn', looksNew);
    if (looksNew) hint.textContent = 'Looks like a new problem — hit “New problem” to solve it fresh.';
    else if (hint.textContent.startsWith('Looks like')) hint.textContent = '';
  });

  function openWorkspace() {
    ws.classList.remove('hidden');
    updateLive();
    // Re-sync the anchor from the main process (a spoken turn may have set it).
    window.stealthAPI.getActiveProblem().then(({ problem }) => {
      if (problem && !anchored) setAnchor(problem);
    }).catch(() => {});
    setTimeout(() => input.focus(), 30);
  }
  // Closing Code Assist = done with this problem. Detach it (clear the anchor +
  // thread state) so spoken questions afterward — the interviewer moving on to a
  // system-design or unrelated topic — are answered fresh, NOT against the DSA
  // problem that was on screen. Reopening starts a clean paste.
  function closeWorkspace() {
    ws.classList.add('hidden');
    startNewProblem(false);
  }

  codeAssistBtn.addEventListener('click', openWorkspace);
  closeW.addEventListener('click', closeWorkspace);

  // Spoken follow-ups: the main process mirrors any voice-triggered code answer
  // here so the round stays in one thread. Only append while a problem is
  // anchored (otherwise it belongs on the normal answer stage).
  window.stealthAPI.onCodeAnswer((payload) => {
    if (!anchored) return;
    const a = appendTurn(payload.question, 'voice');
    renderAnswerInto(a, payload.text);
    appendMeta(a, payload);
  });

  // Let capture start/stop keep the "● listening" badge honest.
  window.__cwUpdateLive = updateLive;

  reflectMode();
})();
