const groqProvider = require('./providers/groqProvider');
const ollamaProvider = require('./providers/ollamaProvider');
const claudeProvider = require('./providers/claudeProvider');
const backendProvider = require('./providers/backendProvider');

function resolveProvider(config) {
  if (config.llmProvider === 'backend') {
    return [backendProvider, { backendUrl: config.backendUrl }];
  }
  if (config.llmProvider === 'groq') {
    return [groqProvider, { apiKey: config.groqApiKey, model: config.groqChatModel }];
  }
  if (config.llmProvider === 'ollama') {
    return [ollamaProvider, { baseUrl: config.ollamaBaseUrl, model: config.ollamaModel }];
  }
  if (config.llmProvider === 'claude') {
    return [claudeProvider, { apiKey: config.anthropicApiKey, model: config.claudeModel }];
  }
  throw new Error(`Unknown LLM_PROVIDER: ${config.llmProvider}`);
}

// Provider-agnostic suggestion + generic-completion interface, selected purely by
// config — callers never branch on provider type. getCompletion() reuses the same
// provider plumbing as getSuggestion() for one-off calls (meta-prompt generation,
// document summarization) instead of overloading getSuggestion's transcript-shaped
// semantics.
function createLlmClient(config) {
  const [provider, providerConfig] = resolveProvider(config);

  const toMessages = (systemPrompt, userPrompt) => [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  return {
    getSuggestion: (args) => provider.getSuggestion(args, providerConfig),
    getCompletion: ({ systemPrompt, userPrompt }) =>
      provider.chatCompletion(toMessages(systemPrompt, userPrompt), providerConfig),
    // Like getCompletion but returns { text, provider, detail } so callers can
    // show which model answered. `forcedProvider` (from the in-app model picker)
    // asks the backend to use that model first. Falls back gracefully for
    // providers that don't expose provenance (direct BYOK groq/ollama/claude).
    getAnswer: async ({ systemPrompt, userPrompt, forcedProvider, preferredProvider }) => {
      const messages = toMessages(systemPrompt, userPrompt);
      if (provider.chatCompletionMeta) return provider.chatCompletionMeta(messages, { ...providerConfig, forcedProvider, preferredProvider });
      return { text: await provider.chatCompletion(messages, providerConfig), provider: null, detail: null };
    },
  };
}

module.exports = { createLlmClient };
