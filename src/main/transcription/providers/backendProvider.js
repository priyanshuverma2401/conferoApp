const fs = require('fs');
const path = require('path');
const sessionStore = require('../../state/sessionStore');

// Uploads a WAV chunk to Confero's backend, which holds the Groq key and returns
// just the transcript text. The end user's app never sees an API key.
async function transcribeFile(filePath, { backendUrl, vocabularyHints }) {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not signed in.');

  const fileBuffer = await fs.promises.readFile(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });

  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  if (vocabularyHints) form.append('prompt', vocabularyHints);

  const res = await fetch(`${backendUrl}/api/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStore.clear();
      throw new Error(err.message || 'You were signed out. Please sign in again.');
    }
    throw new Error(err.error || `Backend transcription failed (${res.status})`);
  }

  const data = await res.json();
  return { text: (data.text || '').trim(), avg_logprob: data.avg_logprob, no_speech_prob: data.no_speech_prob };
}

module.exports = { transcribeFile };
