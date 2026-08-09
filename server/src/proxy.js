const express = require('express');
const multer = require('multer');
const config = require('./config');
const { requireAuth } = require('./auth');
const { chat, extractText } = require('./ai/chat');
const { withGroqKey, throttled } = require('./ai/groqKeys');
const { MODES } = require('./modes');

// Ids of premium-only modes, derived from the mode table so adding `premium:true`
// to a mode is the single source of truth.
const PREMIUM_MODE_IDS = new Set(MODES.filter((m) => m.premium).map((m) => m.id));

// Audio never touches disk — kept in memory only for the moment it takes to
// forward to Groq, then discarded. Nothing about a user's meeting is stored.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// Groq rejects a Whisper `prompt` over 896 CHARACTERS (not tokens, which is what
// Whisper's own ~224-token limit is usually quoted as) with a hard 400. The turbo
// retry below resends the SAME prompt, so an oversized hint fails both attempts —
// and because the hint is rebuilt identically for every chunk, that isn't one bad
// chunk, it's the whole session transcribing nothing. Observed in the wild once a
// user attached a resume: the doc summary pushed the hint past the cap and every
// chunk came back "Transcription upstream error (400)".
// The app caps its own hint, but an INSTALLED build carries whatever cap it
// shipped with, so the ceiling is enforced here too — a stale client can't take a
// user's session down, and no reinstall is needed to fix one.
const MAX_STT_PROMPT_CHARS = 896;

// Trim at a separator so the hint doesn't end mid-word (a half word biases
// Whisper toward nonsense), but only if that separator is near the end —
// otherwise we'd throw away most of the budget, and the front of the hint is the
// valuable part (the user's own proper nouns come first).
function clampSttPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.length <= MAX_STT_PROMPT_CHARS) return prompt;
  const cut = prompt.slice(0, MAX_STT_PROMPT_CHARS);
  const brk = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  const trimmed = (brk > MAX_STT_PROMPT_CHARS * 0.8 ? cut.slice(0, brk) : cut).trim();
  console.warn(`[transcribe] hint ${prompt.length} chars > ${MAX_STT_PROMPT_CHARS} — trimmed to ${trimmed.length}`);
  return trimmed;
}
// whisper-large-v3 is the most accurate model but has been seen to fail
// transiently (observed HTTP 400 for a stretch one evening); large-v3-turbo is
// a fast, reliable safety net so a transient primary failure never breaks
// transcription or looks like an app hang.
const STT_FALLBACK_MODEL = 'whisper-large-v3-turbo';

async function callGroqTranscribe(model, fileBuffer, originalname, prompt, apiKey) {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: 'audio/wav' }), originalname || 'chunk.wav');
  form.append('model', model);
  // verbose_json exposes Whisper's own per-segment confidence (avg_logprob,
  // no_speech_prob) — the standard signal for detecting hallucinated/silent
  // segments, instead of maintaining a permanently-incomplete phrase blocklist.
  form.append('response_format', 'verbose_json');
  form.append('language', 'en');
  if (prompt) form.append('prompt', prompt);
  return fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
}

// Same call, rotated across the GROQ_API_KEYS pool. Transcription is the heaviest
// consumer of the quota (a request every few seconds, all session), so it is
// where a second key earns its keep.
// Only a 429 moves to the next key. Every other status is RETURNED, not thrown,
// so the model-fallback below still sees it and can retry on turbo exactly as it
// did before — key rotation and model fallback stay independent.
// If all keys are throttled the last 429 Response is handed back rather than
// thrown, so the caller's existing !ok branch reports it unchanged.
async function transcribeRotating(model, fileBuffer, originalname, prompt) {
  let last = null;
  try {
    return await withGroqKey(async (key) => {
      const res = await callGroqTranscribe(model, fileBuffer, originalname, prompt, key);
      if (res.status === 429) { last = res; throw throttled(`Groq transcription rate limited (429)`); }
      return res;
    });
  } catch (err) {
    if (last) return last;
    throw err;
  }
}

// Transcribe: the desktop app uploads a short WAV chunk; we forward it to Groq
// Whisper with the server-held key and return just the text. Falls back from the
// configured model to turbo if the primary fails, so one transient upstream
// error never surfaces as a dead/silent transcript.
router.post('/transcribe', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided.' });

  const primary = config.groqSttModel;
  const prompt = clampSttPrompt(req.body.prompt);
  try {
    let usedModel = primary;
    let groqRes = await transcribeRotating(primary, req.file.buffer, req.file.originalname, prompt);

    if (!groqRes.ok && primary !== STT_FALLBACK_MODEL) {
      const detail = await groqRes.text().catch(() => '');
      console.warn(`[transcribe] "${primary}" failed (${groqRes.status}) — retrying with "${STT_FALLBACK_MODEL}": ${detail.slice(0, 200)}`);
      usedModel = STT_FALLBACK_MODEL;
      groqRes = await transcribeRotating(STT_FALLBACK_MODEL, req.file.buffer, req.file.originalname, prompt);
    }

    if (!groqRes.ok) {
      const detail = await groqRes.text().catch(() => '');
      return res.status(502).json({ error: `Transcription upstream error (${groqRes.status})`, detail });
    }

    const data = await groqRes.json();
    const segment = (data.segments && data.segments[0]) || {};
    res.json({
      text: (data.text || '').trim(),
      avg_logprob: segment.avg_logprob,
      no_speech_prob: segment.no_speech_prob,
      model: usedModel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Suggest: the desktop app sends the system+user messages; we forward to Groq
// chat with the server-held key and return the assistant text.
router.post('/suggest', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
  const { messages, provider, prefer, mode, task } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required.' });
  }

  // Hard premium gate: a premium-only mode (DSA & System Design) is rejected for
  // non-premium plans here on the server, so a patched client can't bypass the
  // locked UI. req.user.plan is the fresh plan requireAuth read from the store.
  if (mode && PREMIUM_MODE_IDS.has(mode) && req.user.plan !== 'premium') {
    return res.status(402).json({
      error: 'premium_required',
      message: 'DSA & System Design is a Confero Premium feature. Upgrade to unlock it.',
    });
  }

  try {
    // Provider-agnostic — the quality-ranked chain picks the best available,
    // unless the app's model picker forces one (strict) or the active mode
    // prefers one (soft, front of the chain with fallback). Returns
    // { text, provider, detail } so the app can show which model answered.
    // `task` picks a server-side generation profile (e.g. the longer budget an
    // end-of-session summary needs) — a name, never raw token counts.
    const result = await chat(messages, { forceProvider: provider, preferProvider: prefer, task });
    res.json(result);
  } catch (err) {
    // Include the attempt trace so the app's QA log records what was tried.
    res.status(502).json({ error: err.message, attempts: err.attempts });
  }
});

// Vision OCR for the Code Assist "Snip" flow: the app captures a region of the
// screen and posts the cropped PNG here to be turned back into text. The image is
// held in memory only for the extraction call — never stored. 8MB cap covers a
// full-screen PNG with headroom.
router.post('/extract-text', requireAuth, express.json({ limit: '8mb' }), async (req, res) => {
  const { image } = req.body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'image (data URL) required.' });
  }
  try {
    const text = await extractText(image);
    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
