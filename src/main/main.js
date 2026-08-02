const fs = require('fs');
const path = require('path');
const { app, session, desktopCapturer, screen, ipcMain, dialog, shell, globalShortcut } = require('electron');
const { initMain: initLoopbackAudio } = require('electron-audio-loopback');
const { loadConfig, isSetupComplete, PRODUCT_NAME, resolveBackendUrl } = require('./config/configLoader');
const { createOverlayWindow, setOverlayCollapsed } = require('./windows/overlayWindow');
const { createIndicatorWindow } = require('./windows/indicatorWindow');
const { createOnboardingWindow } = require('./windows/onboardingWindow');
const { createSnipWindow } = require('./windows/snipWindow');
const { createReportWindow, getReportWindow, closeReportWindow } = require('./windows/reportWindow');
const { startSignin } = require('./auth/signinFlow');
const sessionStore = require('./state/sessionStore');
const { registerStealthToggle, applyScreenShareHidden, unregisterAll } = require('./shortcuts/stealthShortcut');
const { registerIpcHandlers } = require('./ipc/ipcHandlers');
const { registerAudioHandlers } = require('./audio/audioCaptureManager');
const { createTranscriptionEngine } = require('./transcription/transcriptionEngine');
const { isLikelyHallucination } = require('./transcription/hallucinationFilter');
const { createLlmClient } = require('./llm/llmClient');
const userSettingsStore = require('./state/userSettingsStore');
const { registerSettingsHandlers } = require('./settings/settingsIpc');
const { detectProctoring } = require('./guardrail/proctoringGuard');
const { listModes, getMode, setModes } = require('./modes/modes');
const promptBuilder = require('./llm/promptBuilder');
const appState = require('./state/appState');
const sessionsArchive = require('./state/sessionsArchive');
const sessionReport = require('./state/sessionReport');
const qaLog = require('./state/qaLog');
const { createAskBuffer, splitAsks, overlapRatio } = require('./state/askBuffer');

const SUGGESTION_WINDOW_MS = 90 * 1000;
const GUARDRAIL_INTERVAL_MS = 15 * 1000;
const HELP_HOTKEY = 'CommandOrControl+Shift+Space';
let suggestionTimer = null;
let guardrailTimer = null;
// Set to the offending app name whenever proctoring software is detected. While
// set, capture is refused and stealth is forced off — Confero must never be
// usable to cheat on a proctored exam.
let proctoringDetected = null;

// Must run before app is ready — it sets Chromium command-line feature flags.
// Skip thumbnail generation entirely — we only need a source id for loopback
// audio, never the image — since generating screen thumbnails is most of what
// makes desktopCapturer.getSources() slow (measured ~3.4s without this).
const LOOPBACK_SOURCES_OPTIONS = { types: ['screen'], thumbnailSize: { width: 1, height: 1 } };
initLoopbackAudio({ sourcesOptions: LOOPBACK_SOURCES_OPTIONS });

let overlayWin;
let indicatorWin;
let onboardingWin;
let mainAppStarted = false;
// Testing: the in-app model picker forces one provider for the next answers.
let forcedProvider = null;

// Cross-cutting IPC that both the onboarding window and the main app can use.
function registerGlobalIpc() {
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.handle('shell:open-external', (_event, url) => shell.openExternal(url));
  // Modes are needed during onboarding (persona step) AND in the app, so they
  // live here rather than in startMainApp.
  ipcMain.handle('modes:list', () => listModes());
  ipcMain.handle('modes:get-active', () => userSettingsStore.getCachedSettings().activeMode || 'tutoring');
  ipcMain.handle('modes:set-active', async (_event, id) => {
    await userSettingsStore.saveUserSettings({ activeMode: id });
    return { ok: true };
  });
  // Testing model picker: '' / null = auto (best available), else force a provider.
  ipcMain.handle('model:set', (_event, provider) => {
    forcedProvider = provider || null;
    qaLog.log('model_set', { forcedProvider: forcedProvider || 'auto' });
    return { ok: true };
  });
}

// Onboarding-only IPC: open the browser sign-in and wait for the token handoff.
function registerOnboardingIpc() {
  ipcMain.handle('onboarding:start-signin', async (event) => {
    try {
      const backendUrl = resolveBackendUrl();
      const { token } = await startSignin({
        backendUrl,
        // Waking a cold free-tier host can take half a minute; without a word
        // from us the button just sits there and reads as broken.
        onStatus: (text) => {
          if (!event.sender.isDestroyed()) event.sender.send('signin:status', { text });
        },
      });
      sessionStore.saveSession({ token });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('onboarding:complete', () => {
    startMainApp();
    if (onboardingWin && !onboardingWin.isDestroyed()) onboardingWin.close();
    onboardingWin = null;
  });
}

// ── Conversation heuristics ───────────────────────────────────────────────────

// Whisper punctuates, so "?" catches most questions; the interrogative-opener
// check catches imperative asks ("Tell me about...", "Walk me through...").
// Real speakers stack discourse openers first — "Okay, but walk me through..."
// (observed live: exactly that phrasing failed a start-anchored regex) — so
// strip those before testing, and test each sentence, not just the first.
const INTERROGATIVE_RE = /^(what|how|why|when|where|who|which|can|could|would|will|do|does|did|is|are|was|were|tell me|tell us|walk me|walk us|take me|talk me|explain|describe|give me|share|help me understand)\b/i;
const DISCOURSE_PREFIX_RE = /^(okay|ok|so|alright|right|great|well|but|and|now|um|uh|yeah|look|listen|actually|thanks|thank you|perfect|good|fine|sure)[,\s]+/i;
function looksLikeQuestion(text) {
  if (text.includes('?')) return true;
  for (const sentence of text.split(/[.!]+/)) {
    let s = sentence.trim();
    for (let i = 0; i < 4; i++) {
      const stripped = s.replace(DISCOURSE_PREFIX_RE, '').trim();
      if (stripped === s) break;
      s = stripped;
    }
    if (INTERROGATIVE_RE.test(s) && s.split(/\s+/).length >= 4) return true;
  }
  return false;
}

// Read-back detection: if the user's mic line heavily overlaps a recently
// generated answer, they're reading Confero's own words aloud — that must not
// re-enter the AI's context or trigger anything (Confero hearing itself).
function rememberAnswer(text) {
  const tokens = new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length >= 4));
  if (tokens.size === 0) return;
  appState.recentAnswers.push(tokens);
  if (appState.recentAnswers.length > 6) appState.recentAnswers.shift();
}
function isReadBack(text) {
  const tokens = text.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
  if (tokens.length < 4) return false;
  for (const answerTokens of appState.recentAnswers) {
    let hits = 0;
    for (const w of tokens) if (answerTokens.has(w)) hits++;
    if (hits / tokens.length >= 0.6) return true;
  }
  return false;
}

function startMainApp() {
  if (mainAppStarted) return;
  mainAppStarted = true;

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    dialog.showErrorBox(`${PRODUCT_NAME} — configuration needed`, err.message);
    app.quit();
    return;
  }

  // Trusted local content only (no remote pages load in this app) — safe to
  // auto-grant the mic/system-audio capture permissions it needs.
  // clipboard-write belongs here too: without it every `navigator.clipboard`
  // call rejects with NotAllowedError, which silently broke EVERY copy button
  // in the app (session summary/transcript, past sessions, Code Assist's code
  // Copy). Both handlers are needed — Chromium asks the CHECK handler on the
  // clipboard path, not the request handler.
  const ALLOWED_PERMISSIONS = ['media', 'display-capture', 'clipboard-write', 'clipboard-sanitized-write'];
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.includes(permission));

  // Pre-warm Chromium's screen-source enumeration at launch, invisibly, instead
  // of paying its multi-second first-call cost when the user clicks Start.
  desktopCapturer.getSources(LOOPBACK_SOURCES_OPTIONS).catch(() => {});

  overlayWin = createOverlayWindow();
  indicatorWin = createIndicatorWindow();

  overlayWin.webContents.on('console-message', (_event, _level, message) => {
    console.log('[renderer]', message);
  });

  const transcriptionEngine = createTranscriptionEngine(config);
  const llmClient = createLlmClient(config);

  registerIpcHandlers({ overlayWin, indicatorWin, config });
  registerSettingsHandlers({ llmClient, overlayWin });

  // "Hide from screen share": restore the user's saved choice. CONFERO_DEV_VISIBLE
  // still wins so QA can screenshot the overlay regardless of what's persisted.
  if (!process.env.CONFERO_DEV_VISIBLE) {
    const saved = userSettingsStore.getCachedSettings().hideFromScreenShare;
    applyScreenShareHidden(overlayWin, indicatorWin, saved !== false);
  } else {
    appState.stealthEnabled = false;
  }

  // The ONE place a user-initiated flip is handled, for both the header button
  // and the Alt+H hotkey. Turning it back ON is refused while proctoring
  // software is running — the guardrail owns that decision, and a client-side
  // switch must not be able to re-hide the overlay during an exam.
  async function setShareHiddenByUser(enabled, source) {
    const blocked = Boolean(enabled) && Boolean(proctoringDetected);
    const want = Boolean(enabled) && !proctoringDetected;
    applyScreenShareHidden(overlayWin, indicatorWin, want, source);
    // Save only what the user actually CHOSE. A guardrail refusal is forced, and
    // persisting it would quietly wipe their preference — they'd come back after
    // the exam still visible on every screen share without ever asking for it.
    if (!blocked) await userSettingsStore.saveUserSettings({ hideFromScreenShare: want });
    return { enabled: want, blocked };
  }

  ipcMain.handle('stealth:set', (_event, enabled) => setShareHiddenByUser(enabled, 'ui'));

  // Alt+H (config.stealthHotkey) — same toggle, both directions, without having
  // to find the button while someone is watching you.
  registerStealthToggle(overlayWin, indicatorWin, config.stealthHotkey,
    (want) => setShareHiddenByUser(want, 'hotkey'));

  // Floating-bar "Hide": shrink the window to the bar (and back). Distinct from
  // stealth:set above — that one hides Confero from the SCREEN SHARE, this one
  // hides the panel from the candidate's own screen. Neither ends the session.
  ipcMain.handle('overlay:set-collapsed', (_event, collapsed) =>
    setOverlayCollapsed(overlayWin, Boolean(collapsed)));

  const send = (channel, payload) => {
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send(channel, payload);
  };

  // Live plan + curated personas from the backend — best-effort; the local
  // fallbacks cover the offline case, and free is the safe plan default.
  (async () => {
    const token = sessionStore.getToken();
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const r = await fetch(`${config.backendUrl}/api/me`, { headers });
      if (r.ok) {
        const me = await r.json();
        appState.plan = me.plan || 'free';
        // Cached so Settings can name the signed-in account without a second
        // round trip — and so it still shows when the app is offline.
        if (me.email) sessionStore.saveSession({ token, email: me.email });
      }
    } catch (_) { /* offline — stay on free defaults */ }
    try {
      const r = await fetch(`${config.backendUrl}/api/modes`, { headers });
      if (r.ok) setModes((await r.json()).modes);
    } catch (_) { /* offline — local personas stand in */ }
    send('account:plan', { plan: appState.plan });
  })();

  ipcMain.handle('account:get', () => ({ plan: appState.plan, email: sessionStore.getEmail() }));

  // Sign out. Whatever this session captured is archived FIRST — the transcript
  // only lives in memory until something writes it, so dropping the token
  // without saving would throw the user's work away. Stopping the microphone is
  // the renderer's job (it owns the audio graph) and it does that before
  // calling this, exactly as "End session" does.
  //
  // Then relaunch: unwinding a running app back to the onboarding window by
  // hand means undoing timers, capture state, appState and every window, and
  // anything missed leaks into the next account. A relaunch has no such holes.
  ipcMain.handle('auth:sign-out', async () => {
    try {
      const settings = userSettingsStore.getCachedSettings();
      const mode = getMode(settings.activeMode);
      if (!appState.archivedAt && (appState.transcript.length || appState.sessionAnswers.length)) {
        try {
          await sessionsArchive.archiveSession({
            transcript: appState.transcript,
            answers: appState.sessionAnswers,
            modeId: settings.activeMode,
            modeLabel: mode ? mode.label : '',
            modeContext: settings.modeContext && settings.modeContext[settings.activeMode],
            docFileName: (settings.documentContext && settings.documentContext[settings.activeMode] || {}).fileName,
            summary: appState.sessionSummary,
          });
        } catch (err) {
          console.error('[auth] archive before sign-out failed:', err.message);
        }
      }
      qaLog.log('sign_out', {});
      sessionStore.clear();
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Start the upgrade: ask the backend for a PayPal approval URL, open it in the
  // user's browser, then poll /api/me so the app flips to premium on its own the
  // moment the webhook records the payment — no relaunch or manual refresh.
  ipcMain.handle('billing:start-upgrade', async () => {
    const token = sessionStore.getToken();
    if (!token) return { error: 'Please sign in first.' };
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const r = await fetch(`${config.backendUrl}/api/billing/checkout`, { method: 'POST', headers });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) return { error: data.message || data.error || 'Upgrades aren\'t available yet.' };
      await shell.openExternal(data.url);
      pollForPremium(headers);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Poll /api/me until the plan turns premium (payment webhook landed) or we give
  // up after ~10 min. On success, update state and tell the overlay.
  let planPollTimer = null;
  function pollForPremium(headers) {
    if (planPollTimer) return; // one poller at a time
    const started = Date.now();
    planPollTimer = setInterval(async () => {
      if (Date.now() - started > 10 * 60 * 1000) { clearInterval(planPollTimer); planPollTimer = null; return; }
      try {
        const r = await fetch(`${config.backendUrl}/api/me`, { headers });
        if (!r.ok) return;
        const plan = (await r.json()).plan || 'free';
        if (plan === 'premium') {
          appState.plan = 'premium';
          send('account:plan', { plan: 'premium' });
          clearInterval(planPollTimer); planPollTimer = null;
        }
      } catch (_) { /* transient — keep polling */ }
    }, 4000);
  }

  // ── Anti-proctoring guardrail ──────────────────────────────────────────────
  // Force stealth OFF, stop capture, and tell the overlay to lock down whenever
  // proctoring/exam-lockdown software is running. Checked at launch and on an
  // interval, so it also catches a proctoring app opened mid-session.
  async function enforceGuardrail() {
    const hit = await detectProctoring();
    const wasClear = !proctoringDetected;
    proctoringDetected = hit;
    if (hit) {
      // Never allow hidden use in an exam. Goes through the shared setter so the
      // header toggle and indicator pill both reflect it — but it is NOT
      // persisted, because this is forced, not chosen.
      applyScreenShareHidden(overlayWin, indicatorWin, false);
      appState.capturing = false;
      send('guardrail:blocked', { app: hit });
    } else if (!wasClear) {
      // Proctoring software closed — clear the lockdown and put the user's own
      // "hide from screen share" choice back.
      send('guardrail:cleared', {});
      if (!process.env.CONFERO_DEV_VISIBLE) {
        applyScreenShareHidden(overlayWin, indicatorWin, userSettingsStore.getCachedSettings().hideFromScreenShare !== false);
      }
    }
  }
  enforceGuardrail();
  guardrailTimer = setInterval(enforceGuardrail, GUARDRAIL_INTERVAL_MS);

  // ── Shared context helpers ────────────────────────────────────────────────
  const docSummary = () => {
    const settings = userSettingsStore.getCachedSettings();
    const dc = settings.documentContext && settings.documentContext[settings.activeMode];
    return dc ? dc.summary : null;
  };
  // Per-mode context the user set before the session (job description, talk
  // topic, etc.) — the strongest available grounding for interpreting an
  // ambiguous transcript, so every assist call gets it alongside the transcript.
  const activeModeContext = () => {
    const settings = userSettingsStore.getCachedSettings();
    return (settings.modeContext && settings.modeContext[settings.activeMode]) || null;
  };
  // Read-back lines are the user reciting Confero's own words — never context.
  const cleanTranscript = () => appState.transcript.filter((t) => !t.readBack);

  // How many recent lines go into an answer verbatim. Older content is carried by
  // candidateNotes() (below) so it doesn't just fall off a cliff.
  const RECENT_WINDOW = 20;
  const recentWindow = () => cleanTranscript().slice(-RECENT_WINDOW);

  // Persistent, role-separated memory of what the CANDIDATE (mic) has said this
  // session — their self-intro, projects, tools, decisions. The recent window
  // only holds the last ~20 lines, so a project the candidate mentioned 4-5
  // questions ago has scrolled out by the time the interviewer follows up on it
  // ("how did you scale that?"). We keep the candidate's substantive statements
  // that are NO LONGER in the recent window, bounded by count + chars, so the
  // answer can be grounded in what they actually claimed earlier. Interviewer
  // (system) turns are deliberately excluded — this is the candidate's own record.
  const candidateNotes = () => {
    const inRecent = new Set(recentWindow());
    const said = cleanTranscript()
      .filter((t) => t.source === 'mic' && !inRecent.has(t))
      .map((t) => t.text.trim())
      .filter((t) => t.split(/\s+/).length >= 5); // drop "yes", "okay got it" filler
    const out = [];
    let chars = 0;
    for (let i = said.length - 1; i >= 0 && out.length < 20 && chars < 1800; i--) {
      out.unshift(said[i]);
      chars += said[i].length;
    }
    return out;
  };

  // Tracks the newest transcript timestamp already covered by an answer or
  // suggestion, so the ambient loop never re-answers content the question
  // pipeline (or a previous tick) already handled.
  let lastSuggestedAt = 0;
  let suggestionInFlight = false;
  const markCovered = () => {
    const latest = appState.transcript.length
      ? appState.transcript[appState.transcript.length - 1].timestamp
      : Date.now();
    lastSuggestedAt = Math.max(lastSuggestedAt, latest);
  };

  // ── Ask buffer: the CLICK is the question boundary ────────────────────────
  // Everything the interviewer says accumulates here; "Answer now" takes the lot
  // as the question and clears it, so the next utterance starts question N+1.
  // The rationale (and what this replaced) is in state/askBuffer.js. The closed
  // question + its answer stay in appState.lastQA, so a follow-up is answered
  // against what was already said (threadClause), alongside candidateNotes().
  const askBuffer = createAskBuffer();

  // Speaker attribution is by audio stream (system = interviewer, mic = candidate),
  // which is clean on headphones. On SPEAKERS the mic also picks up the
  // interviewer's voice, so their words would land a second time as a [Me] turn
  // and pollute the candidate's record. If a mic line heavily overlaps a recent
  // interviewer (system) line, treat it as that bleed and drop it from context —
  // same handling as a read-back.
  function isInterviewerEcho(text) {
    const recentThem = appState.transcript.filter((t) => t.source === 'system').slice(-4);
    return recentThem.some((t) => overlapRatio(t.text, text) >= 0.6);
  }

  // isQuestion no longer gates anything — it only tints the UI hint and the QA
  // log. The buffer keeps every line, because a question routinely arrives
  // wrapped in context the old gate threw away.
  function onThemUtterance(text, isQuestion) {
    if (askBuffer.push(text)) send('answer:listening', { question: askBuffer.text(), isQuestion });
  }

  // ── Question-triggered answer pipeline ────────────────────────────────────
  // ONE answer call returns the whole structured answer (lead line + scenario
  // blocks). It used to be two parallel calls — a fast "quick take" and a
  // separate "full" — but they each independently guessed any mis-heard term
  // and could DISAGREE (observed live: quick said "Fenergo", full invented
  // "GenAI"). A candidate can't act on two different answers. One call =
  // guaranteed-consistent answer, and half the tokens per question (our free-
  // tier quota is the real bottleneck). Up-next stays a separate best-effort
  // call. A newer question retires an older run via the generation counter.
  // `typed` = the question came from the ask bar (the user typed it) rather than
  // from the microphone. Same pipeline, same rendering — only the framing of the
  // prompt and a couple of downstream niceties differ.
  let pipelineGeneration = 0;
  // `rawSpeech` says questionText is a captured STRETCH of the interviewer
  // talking rather than a tidy one-line question, so the prompt asks the model
  // to find the actual ask inside it. Mutually exclusive with `typed` in
  // practice: what the user types IS the question, with nothing to dig out.
  async function runAnswerPipeline(questionText, { typed = false, rawSpeech = false } = {}) {
    const gen = ++pipelineGeneration;
    const modeContext = activeModeContext();
    const documentContext = docSummary();
    // DSA / System-Design mode produces code + scratchpad (not speakable bullets),
    // and defaults to a coding-strong model. answerFormat drives both the prompt
    // shape and the renderer's code-block display.
    const mode = getMode(userSettingsStore.getCachedSettings().activeMode);
    const isCode = Boolean(mode && mode.answerFormat === 'code');
    const preferredProvider = (mode && mode.preferredProvider) || null;

    // Adaptive follow-up threading is the Pro headline: free gets one taste
    // per session, then answers stop carrying the previous Q+A.
    let prevQA = appState.lastQA;
    let adaptiveUpsell = false;
    // Coding rounds are threaded by nature — "explain the approach", "now optimize",
    // "dry run it" are all follow-ups on ONE anchored problem, so threading is a
    // correctness requirement here, not the premium follow-up surface. Exempt code
    // mode from the free-tier gate; the upsell still applies to spoken modes.
    // A TYPED ask is exempt for the same reason code mode is: half of what the
    // ask bar is for ("shorter", "in bullet points", "go deeper on the second
    // point") is meaningless without the answer it refers to. Stripping the
    // thread there wouldn't limit the feature, it would break it.
    if (prevQA && appState.plan !== 'premium' && !isCode && !typed) {
      if (appState.adaptiveUsed >= 1) {
        prevQA = null;
        adaptiveUpsell = true;
      } else {
        appState.adaptiveUsed += 1;
      }
    }

    markCovered(); // keep the ambient loop quiet for this content
    send('answer:pending', { question: questionText });
    qaLog.log('answer_request', {
      gen, question: qaLog.preview(questionText), forcedProvider: forcedProvider || 'auto',
      hasDoc: !!documentContext, hasModeContext: !!modeContext, threadedFollowup: !!prevQA,
      typed,
    });

    const t0 = Date.now();
    let answer;
    try {
      // Separate the asks HERE rather than making the model find them — a weak
      // fallback model answers the first and pads the rest. When this finds two
      // or more, the prompt gets a numbered list and a block-per-number rule.
      const asks = rawSpeech ? splitAsks(questionText) : [];
      if (asks.length > 1) qaLog.log('multi_ask', { gen, count: asks.length });
      const promptArgs = {
        question: questionText,
        rawSpeech,
        asks,
        transcriptWindow: recentWindow(),
        // What the candidate already told the interviewer earlier this session —
        // so a follow-up on a project/tool they mentioned several questions ago is
        // grounded in what they actually said, not guessed.
        candidateNotes: candidateNotes(),
        modeContext,
        documentContext,
        prevQA,
        // A spoken turn in a coding round is an instruction ABOUT the on-screen
        // problem, not a fresh problem — carry the anchor so the model answers
        // "dry run it" / "make it O(1) space" against what's actually on screen.
        anchoredProblem: isCode ? appState.activeCodingProblem : null,
        // Tells the prompt this line was TYPED by the user, so "in bullet points"
        // is treated as an instruction to me, not as something to answer.
        typedAsk: typed,
      };
      answer = await llmClient.getAnswer({
        systemPrompt: promptBuilder.getSystemPrompt(),
        userPrompt: isCode ? promptBuilder.buildCodeAnswerPrompt(promptArgs) : promptBuilder.buildAnswerPrompt(promptArgs),
        forcedProvider,
        preferredProvider,
        mode: mode && mode.id, // lets the backend enforce premium gating (e.g. DSA)
      });
    } catch (err) {
      qaLog.log('answer_error', { gen, ms: Date.now() - t0, error: err.message, attempts: err.attempts });
      // A typed ask reports its own failure back to the ask bar (which puts the
      // text back in the box) — a banner too would say the same thing twice.
      if (gen === pipelineGeneration && !typed) send('app:error', { message: `Answer error: ${err.message}` });
      return { error: err.message };
    }
    if (gen !== pipelineGeneration) {
      qaLog.log('answer_discarded', { gen, current: pipelineGeneration, provider: answer.provider, ms: Date.now() - t0 });
      return { ok: true }; // a newer question took over
    }
    const answerText = answer.text;
    qaLog.log('answer_received', {
      gen, ms: Date.now() - t0, backendMs: answer.ms,
      provider: answer.provider, model: answer.detail, attempts: answer.attempts,
      answer: qaLog.preview(answerText),
    });
    rememberAnswer(answerText);
    appState.lastQA = { question: questionText, answer: answerText };
    appState.sessionAnswers.push({ kind: 'answer', question: questionText, text: answerText, provider: answer.provider, detail: answer.detail, at: Date.now() });
    send('answer:ready', {
      question: questionText, text: answerText, ms: Date.now() - t0, adaptiveUpsell,
      provider: answer.provider, detail: answer.detail, format: isCode ? 'code' : 'speak',
      origin: typed ? 'typed' : 'voice',
    });

    // Up next is a spoken follow-up prediction — skip it for code modes, where a
    // "likely next question" spoken line makes no sense on a coding scratchpad.
    if (isCode) {
      // Mirror the answer into the Code Assist workspace thread (if open), so a
      // spoken follow-up — "walk me through the approach", "dry run [3,1,2]",
      // "now optimize space" — lands in the same place as the pasted problem it
      // builds on, right next to the candidate's earlier turns.
      if (appState.activeCodingProblem) {
        send('code:answer', {
          question: questionText, text: answerText, ms: Date.now() - t0,
          provider: answer.provider, detail: answer.detail, source: typed ? 'typed' : 'voice',
        });
      }
      return { ok: true };
    }

    // "Up next" predicts what THEY will ask next off the back of what they just
    // asked. A line I typed to myself isn't their turn, so there's nothing to
    // predict from — skip it rather than guess.
    if (typed) return { ok: true };

    // Up next — pure bonus; failures are silent and it never delays anything.
    try {
      const upNextText = await llmClient.getCompletion({
        systemPrompt: 'You are a concise, realistic interview and meeting coach.',
        userPrompt: promptBuilder.buildUpNextPrompt({ question: questionText, answer: answerText, modeContext }),
      });
      if (gen !== pipelineGeneration) return { ok: true };
      appState.sessionAnswers.push({ kind: 'upnext', text: upNextText, at: Date.now() });
      send('answer:upnext', { text: upNextText });
    } catch (_) { /* best-effort only */ }
    return { ok: true };
  }

  // Manual trigger ("Answer now" button or hotkey). This IS the question
  // boundary: everything the interviewer has said since the last answer is the
  // question, and pressing the button closes it so the next thing they say
  // starts a fresh one.
  function triggerHelpNow() {
    const asked = askBuffer.text();
    qaLog.log('help_now', { bufferedLines: askBuffer.size(), chars: asked.length });
    if (asked) {
      askBuffer.clear(); // question N is closed; N+1 starts with their next word
      runAnswerPipeline(asked, { rawSpeech: true });
      return;
    }
    const lines = cleanTranscript();
    if (lines.length === 0) {
      send('answer:quick', { question: null, text: "Nothing captured yet — I'll help once the conversation starts.", ms: 0 });
      return;
    }
    // Nothing new since the last answer — they're still on the same question, or
    // the candidate wants another crack at it. Re-answer the last thing said.
    const lastThem = [...lines].reverse().find((t) => t.source === 'system');
    const target = lastThem || lines[lines.length - 1];
    runAnswerPipeline(target.text, { rawSpeech: true });
  }

  // ── Audio → transcription → triggering ────────────────────────────────────
  registerAudioHandlers({
    isBlocked: () => proctoringDetected, // start-capture is refused while set
    onSessionStart: () => {
      appState.lastQA = null;
      appState.adaptiveUsed = 0;
      appState.rephraseUsed = 0;
      appState.recentAnswers = [];
      appState.sawSystemAudio = false;
      appState.sessionAnswers = [];
      appState.sessionSummary = null;
      askBuffer.clear();
      const s = userSettingsStore.getCachedSettings();
      qaLog.log('session_start', { mode: s.activeMode, forcedProvider: forcedProvider || 'auto', plan: appState.plan });
    },
    onChunkWritten: async ({ source, filePath }) => {
      try {
        const { text, ...confidence } = await transcriptionEngine.transcribeFile(filePath);
        if (text && !isLikelyHallucination(text, confidence)) {
          if (source === 'system') appState.sawSystemAudio = true;
          // Interviewer voice bleeding into the mic (candidate on speakers): the
          // same words are already captured on the system stream, so drop the
          // duplicate instead of recording it as a candidate [Me] line. Gated on
          // sawSystemAudio so solo practice (mic-only) never loses real speech.
          if (source === 'mic' && appState.sawSystemAudio && isInterviewerEcho(text)) {
            qaLog.log('transcript_bleed', { text: qaLog.preview(text) });
          } else {
            const readBack = source === 'mic' && isReadBack(text);
            // Only THEIR voice asks questions — except in solo practice (mic
            // only, no system audio yet), where the mic is all we have.
            const canTrigger = source === 'system' || !appState.sawSystemAudio;
            const isQuestion = !readBack && canTrigger && looksLikeQuestion(text);
            const payload = { source, text, timestamp: Date.now(), readBack, isQuestion };
            appState.transcript.push(payload);
            // Fresh speech after an "End session" archive — this session has moved
            // on, so the next Start must save it again rather than skip it.
            appState.archivedAt = null;
            send('transcript:chunk', payload);
            qaLog.log('transcript', { source, readBack, isQuestion, canTrigger, text: qaLog.preview(text) });
            if (canTrigger && !readBack) onThemUtterance(text, isQuestion);
          }
        }
      } catch (err) {
        console.error(`[transcription] failed for ${filePath}:`, err.message);
        send('app:error', { message: `Transcription error: ${err.message}` });
      } finally {
        // Ephemeral by design — nothing persists beyond what's needed to transcribe it.
        fs.unlink(filePath, () => {});
      }
    },
  });

  // ── On-demand assist + recap + rephrase ───────────────────────────────────
  ipcMain.handle('assist:help-now', () => {
    triggerHelpNow();
    return { ok: true }; // results stream back via answer:* events
  });

  // Ask bar: a question the other person never asked, or an instruction about the
  // answer already on screen ("in bullet points", "shorter", "more technical").
  // Same pipeline as a spoken question so it renders in the same place, in the
  // same format — awaited here only so a failure can be reported back into the
  // box instead of losing what the user typed.
  ipcMain.handle('assist:ask', async (_event, { text }) => {
    const q = (text || '').trim();
    if (!q) return { error: 'Type a question or an instruction first.' };
    qaLog.log('typed_ask', { chars: q.length, question: qaLog.preview(q) });
    // Deliberately does NOT touch askBuffer: that holds what the OTHER person
    // has said and is still waiting on an answer. A typed aside is mine, so it
    // must neither be glued onto their pending question nor discard it.
    // rawSpeech stays false — typed text IS the question, with nothing to dig out.
    const res = await runAnswerPipeline(q, { typed: true });
    return res || { ok: true };
  });

  // ── Code Assist workspace (DSA / LLD rounds) ──────────────────────────────
  // The candidate pastes the interviewer's on-screen problem here. These calls
  // run OUTSIDE runAnswerPipeline's generation counter on purpose: a paste (or a
  // typed follow-up) can land at any instant, and a concurrent SPOKEN turn must
  // not retire it — nor it the spoken one. They share one thing with the voice
  // path: the anchored problem + lastQA, so voice and typed turns build on each
  // other. Direct request/response (invoke) — the result returns to the caller.
  async function solveCode({ question, prevQA, anchoredProblem, instruction }) {
    const mode = getMode(userSettingsStore.getCachedSettings().activeMode);
    const preferredProvider = (mode && mode.preferredProvider) || null;
    const q = instruction && instruction.trim() ? `${question}\n\n(${instruction.trim()})` : question;
    const t0 = Date.now();
    const answer = await llmClient.getAnswer({
      systemPrompt: promptBuilder.getSystemPrompt(),
      userPrompt: promptBuilder.buildCodeAnswerPrompt({
        question: q,
        transcriptWindow: recentWindow(),
        candidateNotes: candidateNotes(),
        modeContext: activeModeContext(),
        documentContext: docSummary(),
        prevQA,
        anchoredProblem,
      }),
      forcedProvider,
      preferredProvider,
      mode: mode && mode.id, // premium gate: Code Assist runs in DSA (premium) mode
    });
    // Thread state so the NEXT turn (spoken or typed) builds on this one.
    appState.lastQA = { question, answer: answer.text };
    appState.sessionAnswers.push({ kind: 'code', question, text: answer.text, provider: answer.provider, detail: answer.detail, at: Date.now() });
    return { text: answer.text, provider: answer.provider, detail: answer.detail, ms: Date.now() - t0 };
  }

  ipcMain.handle('assist:solve-problem', async (_event, { problem, instruction }) => {
    const text = (problem || '').trim();
    if (!text) return { error: 'Paste the problem first.' };
    appState.activeCodingProblem = text; // anchor immediately, before the LLM call
    qaLog.log('code_solve', { instruction: instruction || null, chars: text.length });
    try {
      return await solveCode({ question: text, prevQA: null, anchoredProblem: null, instruction });
    } catch (err) {
      qaLog.log('code_solve_error', { error: err.message });
      return { error: err.message };
    }
  });

  ipcMain.handle('assist:code-followup', async (_event, { question }) => {
    const q = (question || '').trim();
    if (!q) return { error: 'Type a follow-up first.' };
    qaLog.log('code_followup', { chars: q.length });
    try {
      return await solveCode({ question: q, prevQA: appState.lastQA, anchoredProblem: appState.activeCodingProblem });
    } catch (err) {
      qaLog.log('code_followup_error', { error: err.message });
      return { error: err.message };
    }
  });

  ipcMain.handle('assist:get-problem', () => ({ problem: appState.activeCodingProblem }));
  // Clearing the problem also drops lastQA: the anchored DSA problem and its Q+A
  // are the code thread, and if that thread lingers a spoken question on a NEW
  // topic gets answered as a follow-up to the old problem (observed: HLD question
  // answered against the previous DSA problem). Wipe both so the next turn is clean.
  ipcMain.handle('assist:clear-problem', () => {
    appState.activeCodingProblem = null;
    appState.lastQA = null;
    return { ok: true };
  });

  // ── Snip → OCR: capture a screen region and turn it back into text ─────────
  // The candidate drags a rectangle on a stealth (content-protected) overlay; we
  // grab the screen, crop to that region, and send the crop to the backend's
  // vision model. The extracted text flows back into the Code Assist paste box,
  // editable before solving — so a misread constraint is caught by a human, not
  // acted on blind. The whole thing is invisible to the interviewer's screen-share.
  let snipWin = null;
  let snipResolve = null;

  async function captureRegion(rect) {
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor || 1;
    const { width, height } = display.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Could not capture the screen.');
    // The overlay reports the rectangle in DIP (CSS px); the capture is in
    // physical pixels, so scale the crop by the display's scaleFactor.
    const full = src.thumbnail.getSize();
    const crop = {
      x: Math.max(0, Math.min(Math.round(rect.x * scale), full.width - 1)),
      y: Math.max(0, Math.min(Math.round(rect.y * scale), full.height - 1)),
      width: Math.max(1, Math.round(rect.width * scale)),
      height: Math.max(1, Math.round(rect.height * scale)),
    };
    crop.width = Math.min(crop.width, full.width - crop.x);
    crop.height = Math.min(crop.height, full.height - crop.y);
    let img = src.thumbnail.crop(crop);
    // Vision APIs cap resolution; a big crop just wastes tokens/latency.
    const s = img.getSize();
    const MAX = 1600;
    if (Math.max(s.width, s.height) > MAX) {
      img = s.width >= s.height ? img.resize({ width: MAX }) : img.resize({ height: MAX });
    }
    return img.toDataURL();
  }

  async function extractViaBackend(dataUrl) {
    const token = sessionStore.getToken();
    const res = await fetch(`${config.backendUrl}/api/extract-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image: dataUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Extraction failed (${res.status})`);
    return (data.text || '').trim();
  }

  function closeSnip() {
    if (snipWin && !snipWin.isDestroyed()) { try { snipWin.close(); } catch (_) { /* ignore */ } }
    snipWin = null;
  }

  ipcMain.handle('snip:start', () => {
    if (proctoringDetected) return Promise.resolve({ error: 'Disabled during a proctored exam.' });
    closeSnip();
    return new Promise((resolve) => {
      snipResolve = resolve;
      snipWin = createSnipWindow();
      snipWin.on('closed', () => {
        snipWin = null;
        if (snipResolve) { snipResolve({ cancelled: true }); snipResolve = null; }
      });
    });
  });

  ipcMain.on('snip:cancel', () => closeSnip()); // 'closed' handler resolves cancelled

  ipcMain.on('snip:region', async (_event, rect) => {
    const resolve = snipResolve;
    snipResolve = null; // take ownership so the 'closed' handler doesn't also resolve
    const win = snipWin;
    try {
      // Hide the overlay before grabbing the screen so its dim/selection never
      // lands in the capture, then give the compositor a beat to repaint.
      if (win && !win.isDestroyed()) win.hide();
      await new Promise((r) => setTimeout(r, 90));
      const dataUrl = await captureRegion(rect);
      closeSnip();
      qaLog.log('snip_capture', { w: Math.round(rect.width), h: Math.round(rect.height) });
      const text = await extractViaBackend(dataUrl);
      qaLog.log('snip_extracted', { chars: text.length });
      if (resolve) resolve({ text });
    } catch (err) {
      closeSnip();
      qaLog.log('snip_error', { error: err.message });
      if (resolve) resolve({ error: err.message });
    }
  });

  ipcMain.handle('assist:rephrase', async (_event, { text }) => {
    if (appState.plan !== 'premium' && appState.rephraseUsed >= 1) {
      return { upsell: true };
    }
    appState.rephraseUsed += 1;
    try {
      const rephrased = await llmClient.getCompletion({
        systemPrompt: promptBuilder.getSystemPrompt(),
        userPrompt: promptBuilder.buildRephrasePrompt({ text }),
      });
      rememberAnswer(rephrased);
      appState.sessionAnswers.push({ kind: 'take2', text: rephrased, at: Date.now() });
      return { text: rephrased };
    } catch (err) {
      return { error: err.message };
    }
  });

  // A two-hour meeting's transcript doesn't fit in a prompt. Keep the head and
  // the tail — the opening frames the session and the close carries the
  // commitments — and mark the elision so the model knows not to claim coverage
  // of the middle.
  const QA_TRANSCRIPT_CHARS = 15000;
  function clipForQa(transcript) {
    const t = String(transcript || '');
    if (t.length <= QA_TRANSCRIPT_CHARS) return t;
    const head = t.slice(0, 6000);
    const tail = t.slice(-(QA_TRANSCRIPT_CHARS - 6000));
    return `${head}\n\n[… middle of the transcript omitted for length — the summary above covers it …]\n\n${tail}`;
  }

  // ── End of session: the report window ─────────────────────────────────────
  // The closing act of a call. The transcript is assembled locally (instant) and
  // the report window opens on it straight away; the summary is one LLM pass —
  // or two for a long meeting, which is chunked and merged in sessionReport —
  // and is pushed in when it lands, so the user is never staring at a spinner
  // with nothing to read. Ending also ARCHIVES the session right away, with its
  // summary, so it survives the app being closed instead of only being saved
  // when a later session starts.
  //
  // `reportState` is what the window renders; `reportSource` is what Regenerate
  // and Ask work from — a SNAPSHOT of the lines taken at end time, because the
  // pipeline keeps running underneath and appState.transcript can move on.
  let reportState = null;
  let reportSource = null;
  let reportChat = [];

  const reportPayload = () => (reportState ? { ...reportState, chat: reportChat } : null);

  function pushReport() {
    const win = getReportWindow();
    if (win) win.webContents.send('report:data', reportPayload());
  }

  // The overlay is alwaysOnTop by design; a maximized report underneath it is
  // unreadable, so it stands down while the report is open and goes back up
  // when the report closes.
  function openReport() {
    createReportWindow({
      productName: PRODUCT_NAME,
      onClosed: () => {
        if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setAlwaysOnTop(true, 'screen-saver');
      },
    });
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setAlwaysOnTop(false);
    pushReport();
  }

  async function writeSummary() {
    const t0 = Date.now();
    reportState.generating = true;
    reportState.error = null;
    pushReport();
    try {
      const summary = await sessionReport.summarize({
        llmClient,
        promptBuilder,
        lines: reportSource.lines,
        modeId: reportSource.modeId,
        modeLabel: reportSource.modeLabel,
        modeContext: reportSource.modeContext,
        documentContext: reportSource.documentContext,
      });
      reportState.summary = summary;
      if (summary) qaLog.log('session_summary', { ms: Date.now() - t0, chars: summary.length });
    } catch (err) {
      reportState.error = err.message;
      qaLog.log('session_summary_error', { error: err.message });
    }
    reportState.generating = false;
    return reportState.summary;
  }

  ipcMain.handle('session:end', async () => {
    const settings = userSettingsStore.getCachedSettings();
    const modeId = settings.activeMode;
    const mode = getMode(modeId);
    const modeLabel = mode ? mode.label : '';
    const lines = cleanTranscript();
    const stats = sessionReport.stats(lines);
    const answered = appState.sessionAnswers.filter((a) => a.kind === 'answer' || a.kind === 'code').length;
    reportChat = [];

    if (!lines.length) {
      reportState = { empty: true, transcript: '', summary: '', stats, answered, modeLabel, modeId };
      reportSource = null;
      openReport();
      return { ...reportState };
    }

    const transcript = sessionReport.formatTranscript(lines, { modeId, modeLabel, productName: PRODUCT_NAME });
    qaLog.log('session_end', { mode: modeId, lines: lines.length, answered, ms: stats.durationMs });

    reportState = {
      title: 'Session report',
      transcript, summary: '', error: null, generating: true,
      stats, answered, modeLabel, modeId, saved: null,
    };
    reportSource = {
      lines, modeId, modeLabel,
      modeContext: activeModeContext(),
      documentContext: docSummary(),
      savedId: null,
    };
    openReport();

    const summary = await writeSummary();
    if (summary) appState.sessionSummary = summary;
    pushReport();

    if (!appState.archivedAt) {
      try {
        const saved = await sessionsArchive.archiveSession({
          transcript: appState.transcript,
          answers: appState.sessionAnswers,
          modeId,
          modeLabel,
          modeContext: settings.modeContext && settings.modeContext[modeId],
          docFileName: (settings.documentContext && settings.documentContext[modeId] || {}).fileName,
          summary: appState.sessionSummary,
        });
        if (saved) {
          appState.archivedAt = Date.now();
          reportState.saved = saved;
          reportSource.savedId = saved.id;
        }
      } catch (err) {
        console.error('[sessions] archive failed:', err.message);
      }
    }
    pushReport();

    return { ...reportState };
  });

  // Re-open a SAVED session in the same window — the summary, the transcript and
  // the Q&A all work the same way whether the call ended a minute or a month ago.
  ipcMain.handle('report:open-session', async (_event, id) => {
    const record = await sessionsArchive.getSession(id);
    if (!record) return { error: 'That session could not be loaded.' };
    const lines = (record.transcript || []).filter((t) => !t.readBack);
    const mode = getMode(record.modeId);
    const modeLabel = mode ? mode.label : '';
    const answered = (record.answers || []).filter((a) => a.kind === 'answer' || a.kind === 'code').length;
    reportChat = [];
    reportState = {
      title: record.name || 'Session report',
      transcript: sessionReport.formatTranscript(lines, { modeId: record.modeId, modeLabel, productName: PRODUCT_NAME }),
      summary: record.summary || '',
      error: null,
      generating: false,
      empty: !lines.length,
      stats: sessionReport.stats(lines),
      answered,
      modeLabel,
      modeId: record.modeId,
      saved: { id: record.id, name: record.name },
    };
    reportSource = {
      lines, modeId: record.modeId, modeLabel,
      modeContext: record.modeContext || null,
      documentContext: null,
      savedId: record.id,
    };
    openReport();
    return { ok: true };
  });

  ipcMain.handle('report:get', () => reportPayload());

  ipcMain.handle('report:clear-chat', () => { reportChat = []; return { ok: true }; });

  // Download PDF. printToPDF renders the LIVE page under print media, and the
  // page keeps a print-only block holding the summary AND the transcript — so
  // the file is the whole report regardless of which tab happens to be open,
  // rather than a screenshot of the current view.
  ipcMain.handle('report:export-pdf', async () => {
    const win = getReportWindow();
    if (!win) return { error: 'The report window is closed.' };
    if (!reportState || reportState.empty) return { error: 'There is no report to export.' };

    const stamp = new Date(reportState.stats && reportState.stats.startedAt ? reportState.stats.startedAt : Date.now())
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const base = `${PRODUCT_NAME} — ${reportState.title || 'Session report'} — ${stamp}`
      .replace(/[\\/:*?"<>|\r\n]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save session report',
      defaultPath: path.join(app.getPath('downloads'), `${base}.pdf`),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { cancelled: true };

    try {
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.55, bottom: 0.55, left: 0.55, right: 0.55 },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#8a8a95;text-align:center;">'
          + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      await fs.promises.writeFile(filePath, pdf);
      qaLog.log('report_pdf', { bytes: pdf.length });
      return { path: filePath };
    } catch (err) {
      qaLog.log('report_pdf_error', { error: err.message });
      return { error: err.message };
    }
  });

  // "Show in folder" from the saved-confirmation — the user just made a file and
  // the next thing they want is to attach it somewhere.
  ipcMain.on('report:reveal', (_event, filePath) => {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
  });

  ipcMain.on('report:close', () => closeReportWindow());

  // "Write it again" — same material, fresh pass. Worth having as a first-class
  // action because summary quality is model-variance-bound on the free tiers.
  ipcMain.handle('report:regenerate', async () => {
    if (!reportState || !reportSource || !reportSource.lines.length) {
      return { error: 'There is no session to summarize.' };
    }
    const summary = await writeSummary();
    if (summary) {
      appState.sessionSummary = summary;
      // Keep the archived copy in step, or Past sessions serves the version the
      // user just rejected.
      if (reportSource.savedId) {
        try {
          await sessionsArchive.updateSessionSummary(reportSource.savedId, summary);
        } catch (err) {
          console.error('[sessions] summary update failed:', err.message);
        }
      }
      qaLog.log('session_summary_regenerated', { chars: summary.length });
    }
    pushReport();
    return reportPayload();
  });

  // Grounded Q&A over the finished session. Uses the `summary` generation
  // profile — a document-length budget with the spoken-answer cleaners off; the
  // live-answer default would cut an answer off mid-list.
  ipcMain.handle('report:ask', async (_event, { question } = {}) => {
    const q = String(question || '').trim();
    if (!q) return { error: 'Ask a question first.' };
    if (!reportState || reportState.empty) return { error: 'There is no session to ask about.' };
    try {
      const answer = await llmClient.getCompletion({
        systemPrompt:
          'You answer questions about a meeting or interview the user just had, using only the '
          + 'transcript and summary you are given. You never invent facts, names, numbers or '
          + 'commitments, and you say plainly when something did not come up. You answer briefly, '
          + 'in plain text, using "- " bullets when you list things.',
        userPrompt: promptBuilder.buildMeetingQaPrompt({
          question: q,
          transcriptText: clipForQa(reportState.transcript),
          summary: reportState.summary,
          modeLabel: reportState.modeLabel,
          history: reportChat.slice(-3),
        }),
        task: 'summary',
      });
      reportChat.push({ q, a: answer, at: Date.now() });
      qaLog.log('report_question', { chars: q.length, answerChars: (answer || '').length });
      return { answer };
    } catch (err) {
      qaLog.log('report_question_error', { error: err.message });
      return { error: err.message };
    }
  });

  // ── Sessions: auto-archive the old, open fresh ────────────────────────────
  // Called by the renderer before starting a new capture when leftover content
  // exists: the previous session is saved under a human name (from the doc /
  // context), and the workspace resets clean.
  ipcMain.handle('sessions:archive-and-reset', async () => {
    const settings = userSettingsStore.getCachedSettings();
    const mode = getMode(settings.activeMode);
    let saved = null;
    // Already archived by "End session" and nothing said since — saving again
    // would put the same conversation in history twice.
    if (!appState.archivedAt) {
      try {
        saved = await sessionsArchive.archiveSession({
          transcript: appState.transcript,
          answers: appState.sessionAnswers,
          modeId: settings.activeMode,
          modeLabel: mode ? mode.label : '',
          modeContext: settings.modeContext && settings.modeContext[settings.activeMode],
          docFileName: (settings.documentContext && settings.documentContext[settings.activeMode] || {}).fileName,
          summary: appState.sessionSummary,
        });
      } catch (err) {
        console.error('[sessions] archive failed:', err.message);
      }
    }
    appState.transcript = [];
    appState.runningSummary = '';
    appState.lastQA = null;
    appState.sessionAnswers = [];
    appState.recentAnswers = [];
    appState.sessionSummary = null;
    appState.archivedAt = null;
    appState.activeCodingProblem = null; // fresh session → drop the anchored problem
    return { ok: true, saved };
  });
  ipcMain.handle('sessions:list', () => sessionsArchive.listSessions());
  ipcMain.handle('sessions:get', (_event, id) => sessionsArchive.getSession(id));

  ipcMain.handle('assist:recap', async () => {
    const lines = cleanTranscript();
    if (lines.length === 0) return { text: 'Nothing to recap yet.' };
    try {
      const text = await llmClient.getCompletion({
        systemPrompt: 'You are a concise meeting/lesson summarizer. Output only bullets.',
        userPrompt: promptBuilder.buildRecapPrompt({ transcriptWindow: lines }),
      });
      return { text };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Global hotkey: help without hunting for a button mid-screen-share.
  try {
    globalShortcut.register(HELP_HOTKEY, () => {
      if (!proctoringDetected) triggerHelpNow();
    });
  } catch (err) {
    console.warn(`[hotkey] could not register ${HELP_HOTKEY}:`, err.message);
  }

  // ── Ambient suggestions (quiet whenever the pipeline is doing the work) ───
  // A couple of stray words isn't a reason to interrupt the user with a new
  // suggestion; wait until there's a meaningful amount of fresh conversation.
  const MIN_NEW_CHARS = 15;
  suggestionTimer = setInterval(async () => {
    if (suggestionInFlight) return;
    // Ambient nudges only make sense while teaching. In interview / professional /
    // general modes they were firing every ~18s with irrelevant "practice
    // question" walls — cluttering the feed and competing with the real answer
    // for the model. Those modes rely solely on the on-demand answer pipeline.
    if (userSettingsStore.getCachedSettings().activeMode !== 'tutoring') return;
    const cutoff = Date.now() - SUGGESTION_WINDOW_MS;
    const transcriptWindow = cleanTranscript().filter((t) => t.timestamp >= cutoff);
    if (transcriptWindow.length === 0) return;
    const newChars = transcriptWindow
      .filter((t) => t.timestamp > lastSuggestedAt)
      .reduce((n, t) => n + t.text.length, 0);
    if (newChars < MIN_NEW_CHARS) return; // not enough new content — let it accumulate
    lastSuggestedAt = transcriptWindow[transcriptWindow.length - 1].timestamp;
    suggestionInFlight = true;

    try {
      const text = await llmClient.getSuggestion({
        runningSummary: appState.runningSummary,
        transcriptWindow,
        documentContext: docSummary(),
        modeContext: activeModeContext(),
      });
      if (text && text !== '-') {
        appState.sessionAnswers.push({ kind: 'suggestion', text, at: Date.now() });
        send('suggestions:update', { text, timestamp: Date.now() });
      }
    } catch (err) {
      console.error('[llm] suggestion request failed:', err.message);
      send('app:error', { message: `Suggestion error: ${err.message}` });
    } finally {
      suggestionInFlight = false;
    }
  }, config.suggestionIntervalMs);
}

app.whenReady().then(async () => {
  await userSettingsStore.loadUserSettings();
  registerGlobalIpc();

  if (isSetupComplete()) {
    startMainApp();
  } else {
    registerOnboardingIpc();
    onboardingWin = createOnboardingWindow();
  }
});

app.on('will-quit', () => {
  unregisterAll();
  globalShortcut.unregisterAll();
  if (suggestionTimer) clearInterval(suggestionTimer);
  if (guardrailTimer) clearInterval(guardrailTimer);
});

app.on('window-all-closed', () => {
  app.quit();
});
