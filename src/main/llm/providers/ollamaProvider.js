const promptBuilder = require('../promptBuilder');

async function chatCompletion(messages, { baseUrl, model }) {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama chat failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.message?.content || '').trim();
}

function getSuggestion({ runningSummary, transcriptWindow, documentContext, modeContext }, providerConfig) {
  const messages = [
    { role: 'system', content: promptBuilder.getSystemPrompt() },
    { role: 'user', content: promptBuilder.buildSuggestionPrompt({ runningSummary, transcriptWindow, documentContext, modeContext }) },
  ];
  return chatCompletion(messages, providerConfig);
}

module.exports = { chatCompletion, getSuggestion };
