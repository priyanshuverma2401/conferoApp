const fs = require('fs');
const { app, session, desktopCapturer, ipcMain, dialog, shell, globalShortcut } = require('electron');
const { initMain: initLoopbackAudio } = require('electron-audio-loopback');
const { loadConfig, isSetupComplete, PRODUCT_NAME } = require('./config/configLoader');
const { createOverlayWindow } = require('./windows/overlayWindow');
const { createIndicatorWindow } = require('./windows/indicatorWindow');
const { createOnboardingWindow } = require('./windows/onboardingWindow');
const { startSignin } = require('./auth/signinFlow');
const sessionStore = require('./state/sessionStore');
const { registerStealthToggle, unregisterAll } = require('./shortcuts/stealthShortcut');
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
const qaLog = require('./state/qaLog');

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
  ipcMain.handle('onboarding:start-signin', async () => {
    try {
      const backendUrl = process.env.CONFERO_BACKEND_URL || 'http://localhost:8787';
      const { token } = await startSignin({ backendUrl });
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
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });

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
  registerStealthToggle(overlayWin, indicatorWin, config.stealthHotkey);

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
      if (r.ok) appState.plan = (await r.json()).plan || 'free';
    } catch (_) { /* offline — stay on free defaults */ }
    try {
      const r = await fetch(`${config.backendUrl}/api/modes`, { headers });
      if (r.ok) setModes((await r.json()).modes);
    } catch (_) { /* offline — local personas stand in */ }
    send('account:plan', { plan: appState.plan });
  })();

  ipcMain.handle('account:get', () => ({ plan: appState.plan }));

  // ── Anti-proctoring guardrail ──────────────────────────────────────────────
  // Force stealth OFF, stop capture, and tell the overlay to lock down whenever
  // proctoring/exam-lockdown software is running. Checked at launch and on an
  // interval, so it also catches a proctoring app opened mid-session.
  async function enforceGuardrail() {
    const hit = await detectProctoring();
    const wasClear = !proctoringDetected;
    proctoringDetected = hit;
    if (hit) {
      overlayWin.setContentProtection(false); // never allow hidden use in an exam
      appState.stealthEnabled = false;
      appState.capturing = false;
      send('guardrail:blocked', { app: hit });
      if (!indicatorWin.isDestroyed()) indicatorWin.webContents.send('stealth:state-changed', { enabled: false });
    } else if (!wasClear) {
      // Proctoring software closed — clear the lockdown.
      send('guardrail:cleared', {});
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

  // ── End-of-turn settle window ─────────────────────────────────────────────
  // Interviewers pause mid-question, so answering the instant a question-shaped
  // utterance lands means answering half a question (observed live). Instead:
  // wait a short settle window — more of their speech within it merges into the
  // question and re-arms the timer — and if they keep talking right after we
  // fired, abort and re-answer the merged whole.
  const QUESTION_SETTLE_MS = 1300;
  // Generous on purpose: their part-2 utterance must survive ~2s of speech plus
  // ~2-3s of transcription before it can arrive (measured live — 5s missed it).
  const CONTINUATION_WINDOW_MS = 10000;
  let pendingQuestion = null; // { text, timer }
  let lastFired = null; // { text, at }

  // When testing on speakers (or echoey calls), the mic hears the same words
  // the system stream already delivered — appending both duplicates the
  // question. Skip merging text that's mostly already in the pending ask.
  function overlapRatio(haystack, candidate) {
    const have = new Set(haystack.toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
    const words = candidate.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
    if (!words.length) return 1;
    let hits = 0;
    for (const w of words) if (have.has(w)) hits++;
    return hits / words.length;
  }

  function queueQuestion(text) {
    if (pendingQuestion) {
      clearTimeout(pendingQuestion.timer);
      if (overlapRatio(pendingQuestion.text, text) < 0.7) {
        pendingQuestion.text = `${pendingQuestion.text} ${text}`.trim();
      } // else: duplicate phrasing — just re-arm the settle timer
    } else {
      pendingQuestion = { text: text.trim(), queuedAt: Date.now() };
    }
    send('answer:listening', { question: pendingQuestion.text });
    pendingQuestion.timer = setTimeout(() => {
      const q = pendingQuestion.text;
      const waitedMs = Date.now() - (pendingQuestion.queuedAt || Date.now());
      pendingQuestion = null;
      lastFired = { text: q, at: Date.now() };
      qaLog.log('question_fired', { question: qaLog.preview(q), settledMs: waitedMs });
      runAnswerPipeline(q);
    }, QUESTION_SETTLE_MS);
  }

  function onThemUtterance(text, isQuestion) {
    if (pendingQuestion) {
      queueQuestion(text); // still forming the ask — merge whatever follows
      return;
    }
    if (lastFired && Date.now() - lastFired.at < CONTINUATION_WINDOW_MS) {
      // They kept talking right after we fired — the question wasn't done.
      // Re-answer the merged whole; the generation counter retires the old run.
      queueQuestion(`${lastFired.text} ${text}`);
      return;
    }
    if (isQuestion) queueQuestion(text);
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
  let pipelineGeneration = 0;
  async function runAnswerPipeline(questionText) {
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
    if (prevQA && appState.plan !== 'pro') {
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
    });

    const t0 = Date.now();
    let answer;
    try {
      const promptArgs = {
        question: questionText,
        transcriptWindow: cleanTranscript().slice(-20),
        modeContext,
        documentContext,
        prevQA,
      };
      answer = await llmClient.getAnswer({
        systemPrompt: promptBuilder.getSystemPrompt(),
        userPrompt: isCode ? promptBuilder.buildCodeAnswerPrompt(promptArgs) : promptBuilder.buildAnswerPrompt(promptArgs),
        forcedProvider,
        preferredProvider,
      });
    } catch (err) {
      qaLog.log('answer_error', { gen, ms: Date.now() - t0, error: err.message, attempts: err.attempts });
      if (gen === pipelineGeneration) send('app:error', { message: `Answer error: ${err.message}` });
      return;
    }
    if (gen !== pipelineGeneration) {
      qaLog.log('answer_discarded', { gen, current: pipelineGeneration, provider: answer.provider, ms: Date.now() - t0 });
      return; // a newer question took over
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
    });

    // Up next is a spoken follow-up prediction — skip it for code modes, where a
    // "likely next question" spoken line makes no sense on a coding scratchpad.
    if (isCode) return;

    // Up next — pure bonus; failures are silent and it never delays anything.
    try {
      const upNextText = await llmClient.getCompletion({
        systemPrompt: 'You are a concise, realistic interview and meeting coach.',
        userPrompt: promptBuilder.buildUpNextPrompt({ question: questionText, answer: answerText, modeContext }),
      });
      if (gen !== pipelineGeneration) return;
      appState.sessionAnswers.push({ kind: 'upnext', text: upNextText, at: Date.now() });
      send('answer:upnext', { text: upNextText });
    } catch (_) { /* best-effort only */ }
  }

  // Manual trigger ("Answer now" button or hotkey): the user's override — skip
  // the settle window (they know the speaker is done), else answer the latest
  // thing THEY said, falling back to the newest line in solo practice.
  function triggerHelpNow() {
    qaLog.log('help_now', { hasPending: !!pendingQuestion });
    if (pendingQuestion) {
      clearTimeout(pendingQuestion.timer);
      const q = pendingQuestion.text;
      pendingQuestion = null;
      lastFired = { text: q, at: Date.now() };
      runAnswerPipeline(q);
      return;
    }
    const lines = cleanTranscript();
    if (lines.length === 0) {
      send('answer:quick', { question: null, text: "Nothing captured yet — I'll help once the conversation starts.", ms: 0 });
      return;
    }
    const lastThem = [...lines].reverse().find((t) => t.source === 'system');
    const target = lastThem || lines[lines.length - 1];
    lastFired = { text: target.text, at: Date.now() };
    runAnswerPipeline(target.text);
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
      if (pendingQuestion) { clearTimeout(pendingQuestion.timer); pendingQuestion = null; }
      lastFired = null;
      const s = userSettingsStore.getCachedSettings();
      qaLog.log('session_start', { mode: s.activeMode, forcedProvider: forcedProvider || 'auto', plan: appState.plan });
    },
    onChunkWritten: async ({ source, filePath }) => {
      try {
        const { text, ...confidence } = await transcriptionEngine.transcribeFile(filePath);
        if (text && !isLikelyHallucination(text, confidence)) {
          if (source === 'system') appState.sawSystemAudio = true;
          const readBack = source === 'mic' && isReadBack(text);
          // Only THEIR voice asks questions — except in solo practice (mic
          // only, no system audio yet), where the mic is all we have.
          const canTrigger = source === 'system' || !appState.sawSystemAudio;
          const isQuestion = !readBack && canTrigger && looksLikeQuestion(text);
          const payload = { source, text, timestamp: Date.now(), readBack, isQuestion };
          appState.transcript.push(payload);
          send('transcript:chunk', payload);
          qaLog.log('transcript', { source, readBack, isQuestion, canTrigger, text: qaLog.preview(text) });
          if (canTrigger && !readBack) onThemUtterance(text, isQuestion);
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

  ipcMain.handle('assist:rephrase', async (_event, { text }) => {
    if (appState.plan !== 'pro' && appState.rephraseUsed >= 1) {
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

  // ── Sessions: auto-archive the old, open fresh ────────────────────────────
  // Called by the renderer before starting a new capture when leftover content
  // exists: the previous session is saved under a human name (from the doc /
  // context), and the workspace resets clean.
  ipcMain.handle('sessions:archive-and-reset', async () => {
    const settings = userSettingsStore.getCachedSettings();
    const mode = getMode(settings.activeMode);
    let saved = null;
    try {
      saved = await sessionsArchive.archiveSession({
        transcript: appState.transcript,
        answers: appState.sessionAnswers,
        modeId: settings.activeMode,
        modeLabel: mode ? mode.label : '',
        modeContext: settings.modeContext && settings.modeContext[settings.activeMode],
        docFileName: (settings.documentContext && settings.documentContext[settings.activeMode] || {}).fileName,
      });
    } catch (err) {
      console.error('[sessions] archive failed:', err.message);
    }
    appState.transcript = [];
    appState.runningSummary = '';
    appState.lastQA = null;
    appState.sessionAnswers = [];
    appState.recentAnswers = [];
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
