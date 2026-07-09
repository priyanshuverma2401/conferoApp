const fs = require('fs');
const path = require('path');

async function transcribeFile(filePath, { apiKey, model, vocabularyHints }) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });

  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('model', model);
  // verbose_json exposes Whisper's per-segment confidence (avg_logprob,
  // no_speech_prob) so hallucinated/silent segments can be detected from
  // evidence instead of a permanently-incomplete phrase blocklist.
  form.append('response_format', 'verbose_json');
  // Pin to English — without this, Whisper auto-detects language per chunk, and
  // ambiguous/noisy audio can get misclassified as a different language entirely
  // (observed: Hindi output on English speech), producing garbage instead of
  // just a bad transcription.
  form.append('language', 'en');
  // Optional domain-vocabulary bias — Whisper's `prompt` nudges transcription
  // toward specific proper nouns/technical terms it might otherwise mishear.
  if (vocabularyHints) {
    form.append('prompt', vocabularyHints);
  }

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq transcription failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const segment = (data.segments && data.segments[0]) || {};
  return { text: (data.text || '').trim(), avg_logprob: segment.avg_logprob, no_speech_prob: segment.no_speech_prob };
}

module.exports = { transcribeFile };
