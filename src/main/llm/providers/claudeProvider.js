const promptBuilder = require('../promptBuilder');

// Anthropic's API takes the system prompt as a separate top-level field, not as
// a message with role:'system' — extract it here so callers can use the same
// uniform messages-array shape as the other providers.
async function chatCompletion(messages, { apiKey, model }) {
  const systemMessage = messages.find((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system: systemMessage ? systemMessage.content : undefined,
      messages: conversation,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Claude messages API failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

function getSuggestion({ runningSummary, transcriptWindow, documentContext, modeContext }, providerConfig) {
  const messages = [
    { role: 'system', content: promptBuilder.getSystemPrompt() },
    { role: 'user', content: promptBuilder.buildSuggestionPrompt({ runningSummary, transcriptWindow, documentContext, modeContext }) },
  ];
  return chatCompletion(messages, providerConfig);
}

module.exports = { chatCompletion, getSuggestion };
