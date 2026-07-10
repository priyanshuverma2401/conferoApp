const express = require('express');
const multer = require('multer');
const config = require('./config');
const { requireAuth } = require('./auth');
const { chat, extractText } = require('./ai/chat');

// Audio never touches disk — kept in memory only for the moment it takes to
// forward to Groq, then discarded. Nothing about a user's meeting is stored.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// whisper-large-v3 is the most accurate model but has been seen to fail
// transiently (observed HTTP 400 for a stretch one evening); large-v3-turbo is
// a fast, reliable safety net so a transient primary failure never breaks
// transcription or looks like an app hang.
const STT_FALLBACK_MODEL = 'whisper-large-v3-turbo';

async function callGroqTranscribe(model, fileBuffer, originalname, prompt) {
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
    headers: { Authorization: `Bearer ${config.groqApiKey}` },
    body: form,
  });
}

// Transcribe: the desktop app uploads a short WAV chunk; we forward it to Groq
// Whisper with the server-held key and return just the text. Falls back from the
// configured model to turbo if the primary fails, so one transient upstream
// error never surfaces as a dead/silent transcript.
router.post('/transcribe', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided.' });

  const primary = config.groqSttModel;
  const prompt = req.body.prompt;
  try {
    let usedModel = primary;
    let groqRes = await callGroqTranscribe(primary, req.file.buffer, req.file.originalname, prompt);

    if (!groqRes.ok && primary !== STT_FALLBACK_MODEL) {
      const detail = await groqRes.text().catch(() => '');
      console.warn(`[transcribe] "${primary}" failed (${groqRes.status}) — retrying with "${STT_FALLBACK_MODEL}": ${detail.slice(0, 200)}`);
      usedModel = STT_FALLBACK_MODEL;
      groqRes = await callGroqTranscribe(STT_FALLBACK_MODEL, req.file.buffer, req.file.originalname, prompt);
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
  const { messages, provider, prefer } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required.' });
  }

  try {
    // Provider-agnostic — the quality-ranked chain picks the best available,
    // unless the app's model picker forces one (strict) or the active mode
    // prefers one (soft, front of the chain with fallback). Returns
    // { text, provider, detail } so the app can show which model answered.
    const result = await chat(messages, { forceProvider: provider, preferProvider: prefer });
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
