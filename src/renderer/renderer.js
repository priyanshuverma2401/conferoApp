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
const recapBtn = document.getElementById('recapBtn');
const stopBtn = document.getElementById('stopBtn');
const clearBtn = document.getElementById('clearBtn');
const closeBtn = document.getElementById('closeBtn');
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
const sessionsBack = document.getElementById('sessionsBack');
const sessionsClose = document.getElementById('sessionsClose');
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

function hasSessionContent() {
  return Boolean(
    transcriptPane.querySelector('.line') ||
    suggestionsPane.querySelector('.suggestion') ||
    !answerStage.classList.contains('hidden')
  );
}

function updateClearVisibility() {
  const has = hasSessionContent();
  clearBtn.style.display = has ? '' : 'none';
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
function appendTranscriptLine({ source, text, isQuestion, readBack }) {
  transcriptEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.className = `line ${source}${isQuestion ? ' q' : ''}${readBack ? ' readback' : ''}`;
  const tag = source === 'system' ? '[Them]' : '[You]';
  const qChip = isQuestion ? '<span class="q-chip">Q</span>' : '';
  const rbNote = readBack ? '<span class="rb-note">(you, reading)</span>' : '';
  div.innerHTML = `${qChip}<span class="tag">${tag}</span>${escapeHtml(text)}${rbNote}`;
  pinnedAppend(transcriptPane, div);
  tickerText.textContent = `${tag} ${text}`;
  updateClearVisibility();
}

// ── Suggestions feed ──
function appendSuggestion({ text, timestamp, kind }) {
  suggestionsEmpty.style.display = 'none';
  const div = document.createElement('div');
  div.className = `suggestion ${kind || ''}`;
  const time = new Date(timestamp || Date.now()).toLocaleTimeString();
  const label = kind === 'help' ? 'Answer' : kind === 'recap' ? 'Recap' : '';
  const tag = label ? `<span class="s-tag">${label}</span> · ` : '';
  div.innerHTML = `<div class="s-time">${tag}${time}</div>${escapeHtml(text)}`;
  pinnedAppend(suggestionsPane, div);
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
  // Inline fallbacks, most reliable first: our known labels, then any short
  // Title-Case label + colon.
  return (
    splitInline(text, new RegExp(`(${KNOWN_LABELS}):\\s*`, 'gi')) ||
    splitInline(text, /(?:^|[\s.,!?"])([A-Z][A-Za-z'’ -]{2,34}?):\s+/g)
  );
}
// Cluely-style bullets: a short label, then the exact words to speak in bold.
function ansBlocksHtml(blocks) {
  return blocks
    .map((b) => `<div class="ans-block"><span class="ab-label">${escapeHtml(b.cue)}</span><span class="ab-say">"${escapeHtml(b.line)}"</span></div>`)
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
window.stealthAPI.onAnswerReady(({ question, text, ms, adaptiveUpsell, provider, detail, format }) => {
  resetHelpBtn();
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
    stageQ.textContent = question || '';
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
    suggestionsEmpty.style.display = 'none';
    const card = document.createElement('div');
    card.className = 'suggestion help';
    const qLine = question ? `<div class="s-time"><span class="s-tag">Q</span> · ${escapeHtml(question)}</div>` : '';
    const noteLine = note ? `<div class="s-note">🎯 ${escapeHtml(note)}</div>` : '';
    card.innerHTML = `${qLine}${noteLine}<div class="ans-list">${answerHtml}</div><div class="s-time"><span class="s-ms">${stamp}</span></div>`;
    pinnedAppend(suggestionsPane, card);
    currentFeedCard = card;
    if (codeMode) wireCopyButtons(card);
    else attachDiffButton(card, lastAnswerSubstance);
    if (adaptiveUpsell) {
      const hint = document.createElement('div');
      hint.className = 's-time';
      hint.innerHTML = '<span class="s-ms" style="color:var(--amber);cursor:pointer;">Follow-up-aware answers are Pro →</span>';
      hint.addEventListener('click', () => openUpsell('Interviewers never ask just one question. Pro keeps up with every follow-up.'));
      card.appendChild(hint);
    }
  }
  updateClearVisibility();
});

window.stealthAPI.onAnswerUpNext(({ text }) => {
  const parsed = parseUpNext(text);
  const inner = parsed
    ? `<span class="un-tag">Up next</span><b>${escapeHtml(parsed.q)}</b><br>${escapeHtml(parsed.a)}`
    : `<span class="un-tag">Up next</span>${escapeHtml(text)}`;
  if (plan === 'pro') {
    stageUpnext.innerHTML = inner;
    stageUpnext.classList.remove('hidden');
  } else if (currentFeedCard) {
    const div = document.createElement('div');
    div.className = 'stage-upnext';
    div.innerHTML = inner;
    currentFeedCard.appendChild(div);
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
function attachDiffButton(card, sourceText) {
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
  card.appendChild(btn);
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
  if (accepted) { gate.classList.add('hidden'); return; }

  checkbox.addEventListener('change', () => { acceptBtn.disabled = !checkbox.checked; });
  acceptBtn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    try { localStorage.setItem(KEY, AGREEMENT_VERSION); } catch (e) {}
    gate.classList.add('hidden');
  });
  declineBtn.addEventListener('click', () => window.stealthAPI.closeApp());
})();

// ── Init ──
window.stealthAPI.getConfig().then((cfg) => { titleEl.textContent = cfg.productName; });
// The plan drives layout, not just copy: the answer stage is Pro-only, so focus
// mode needs to know which pane is the primary object. Mirror it onto <div id=app>.
function applyPlan(p) {
  plan = p || 'free';
  const isPremium = plan === 'premium';
  appEl.classList.toggle('free', !isPremium);
  // Re-render the mode menu so premium cards lock/unlock, and reflect the plan on
  // the upgrade button, whenever the plan changes (e.g. after a successful upgrade).
  if (Array.isArray(modes) && modes.length) renderModeMenu(activeModeId);
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
initModes();

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
  sessionsList.style.display = '';
  const sessions = await window.stealthAPI.listSessions();
  sessionsList.innerHTML = sessions.length
    ? sessions.map((s) => `
        <button class="session-item" data-id="${s.id}">
          <span class="si-name">${escapeHtml(s.name)}</span>
          <span class="si-meta">${fmtDate(s.savedAt)} · ${s.lines} lines</span>
        </button>`).join('')
    : '<div class="sessions-empty">No saved sessions yet — finish one and start another, and it lands here automatically.</div>';
  sessionsList.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', () => viewSession(el.getAttribute('data-id')));
  });
  sessionsModal.classList.remove('hidden');
}
async function viewSession(id) {
  const s = await window.stealthAPI.getSession(id);
  if (!s) return;
  const parts = [];
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
}
historyBtn.addEventListener('click', openSessions);
sessionsClose.addEventListener('click', () => sessionsModal.classList.add('hidden'));
sessionsBack.addEventListener('click', () => {
  sessionViewer.classList.add('hidden');
  sessionsBack.classList.add('hidden');
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

// ── Capture controls ──
// Focus mode: while live, the stage owns the window; the ticker replaces the
// transcript; feeds return when the session stops (or on a ticker peek).
function setCapturingUi(capturing) {
  isCapturing = capturing;
  startBtn.style.display = capturing ? 'none' : '';
  activeActions.classList.toggle('hidden', !capturing);
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

// ── Testing model picker (only in testing builds; hidden in production) ──
if (SHOW_MODEL_BADGE) {
  const modelBar = document.getElementById('modelBar');
  const modelPicker = document.getElementById('modelPicker');
  if (modelBar && modelPicker) {
    const saved = localStorage.getItem('confero.testModel') || '';
    modelPicker.value = saved;
    window.stealthAPI.setModel(saved);
    modelBar.classList.remove('hidden');
    modelPicker.addEventListener('change', () => {
      localStorage.setItem('confero.testModel', modelPicker.value);
      window.stealthAPI.setModel(modelPicker.value);
      const label = modelPicker.options[modelPicker.selectedIndex].text;
      showNote(modelPicker.value ? `Next answers use: ${label}` : 'Model: auto (best available)');
    });
  }
}

updateClearVisibility();

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
