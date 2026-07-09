const promptBuilder = require('../promptBuilder');
const sessionStore = require('../../state/sessionStore');

// Sends chat messages to Confero's backend, which holds the Groq key and returns
// the assistant text. Prompt construction stays here on the client; the backend
// is a thin authenticated proxy.
// Returns { text, provider, detail } — provider/detail identify which model
// actually answered (for the live "which model" indicator).
async function chatCompletionMeta(messages, { backendUrl, forcedProvider, preferredProvider }) {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(`${backendUrl}/api/suggest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // provider = strict override (model picker); prefer = soft default (active
    // mode's preferred model, front of the fallback chain).
    body: JSON.stringify({ messages, provider: forcedProvider || undefined, prefer: preferredProvider || undefined }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) {
      // Session invalid or superseded on another device — drop it so the app
      // returns to sign-in on next launch, and surface the friendly reason.
      sessionStore.clear();
      throw new Error(err.message || 'You were signed out. Please sign in again.');
    }
    const e = new Error(err.error || `Backend suggestion failed (${res.status})`);
    e.attempts = err.attempts; // carry the provider trace for the QA log
    throw e;
  }

  const data = await res.json();
  return { text: (data.text || '').trim(), provider: data.provider, detail: data.detail, ms: data.ms, attempts: data.attempts };
}

async function chatCompletion(messages, providerConfig) {
  return (await chatCompletionMeta(messages, providerConfig)).text;
}

function getSuggestion({ runningSummary, transcriptWindow, documentContext, modeContext }, providerConfig) {
  const messages = [
    { role: 'system', content: promptBuilder.getSystemPrompt() },
    { role: 'user', content: promptBuilder.buildSuggestionPrompt({ runningSummary, transcriptWindow, documentContext, modeContext }) },
  ];
  return chatCompletion(messages, providerConfig);
}

module.exports = { chatCompletion, chatCompletionMeta, getSuggestion };
