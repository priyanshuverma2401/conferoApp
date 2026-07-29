const promptBuilder = require('../promptBuilder');

// BYOK path: a spoken answer fits in 200 tokens, but an end-of-session summary
// is a multi-section document and would be cut off mid-heading at that budget.
const TASK_TOKENS = { summary: 1100, notes: 700 };

async function chatCompletion(messages, { apiKey, model, task }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: TASK_TOKENS[task] || 200,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq chat completion failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

function getSuggestion({ runningSummary, transcriptWindow, documentContext, modeContext }, providerConfig) {
  const messages = [
    { role: 'system', content: promptBuilder.getSystemPrompt() },
    { role: 'user', content: promptBuilder.buildSuggestionPrompt({ runningSummary, transcriptWindow, documentContext, modeContext }) },
  ];
  return chatCompletion(messages, providerConfig);
}

module.exports = { chatCompletion, getSuggestion };
