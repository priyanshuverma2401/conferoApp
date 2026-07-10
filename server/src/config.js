const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  port: Number(process.env.PORT || 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  // ── Which AI provider generates the suggestions ──────────────────────────
  // Switch providers by changing CHAT_PROVIDER (in render.yaml or the Render
  // dashboard) and pushing — no code change. Each provider just needs its own
  // API key set. Transcription always uses Groq Whisper (fast + cheap).
  //   groq       → free tier, fastest (default)
  //   gemini     → Google Gemini Flash, generous free tier, strong reasoning
  //   openrouter → many models incl. free ones (…:free), easy to experiment
  // Leave CHAT_PROVIDER unset to use the automatic best-model-first quality
  // ordering (recommended). Set it only to force one provider to the front.
  chatProvider: (process.env.CHAT_PROVIDER || '').toLowerCase(),
  // Testing aid: with CHAT_STRICT=1 the app uses ONLY chatProvider (no
  // cross-provider fallback), so every answer comes from the same model for
  // consistent evaluation. If it's momentarily unavailable you get a clear
  // error instead of a silently-different model.
  chatStrict: process.env.CHAT_STRICT === '1',
  // Automatic failover: comma-separated backups tried, in order, if the primary
  // provider errors or times out. e.g. CHAT_FALLBACKS=gemini,openrouter. Backups
  // without a configured key are skipped. Recommended for production resilience.
  chatFallbacks: (process.env.CHAT_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  groqChatModel: process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant',
  // Multimodal model for OCR/text-extraction from a snipped screen region. Groq's
  // Llama-4 Scout is vision-capable and OpenAI-compatible (image_url content).
  groqVisionModel: process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
  geminiVisionModel: process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash',

  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // A pool of Gemini keys (GEMINI_API_KEYS, comma-separated) plus the single
  // GEMINI_API_KEY — rotated on 429 so a key with remaining quota is used before
  // giving up on Gemini. NOTE: keys under the same Google project SHARE quota, so
  // a pool only adds capacity if the keys live in separate projects.
  geminiApiKeys: [
    ...(process.env.GEMINI_API_KEYS || '').split(',').map((s) => s.trim()),
    process.env.GEMINI_API_KEY || '',
  ].filter((v, i, a) => v && a.indexOf(v) === i),
  // 'latest' alias auto-tracks Google's current Flash model, so a model being
  // retired never breaks us (gemini-1.5-flash was sunset, which caused exactly that).
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',

  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  // Default to a strong 70B-class free model, not an 8B — every rung of the
  // quality ladder should be a capable model.
  openrouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  // Qwen3-Coder via OpenRouter (free) — the DSA/System-Design mode's preferred
  // model, a purpose-built coding model (free DeepSeek slugs were retired to paid).
  qwenCoderModel: process.env.QWEN_CODER_MODEL || 'qwen/qwen3-coder:free',

  cerebrasApiKey: process.env.CEREBRAS_API_KEY || '',
  cerebrasModel: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',

  mistralApiKey: process.env.MISTRAL_API_KEY || '',
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-small-latest',

  togetherApiKey: process.env.TOGETHER_API_KEY || '',
  togetherModel: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',

  cohereApiKey: process.env.COHERE_API_KEY || '',
  cohereModel: process.env.COHERE_MODEL || 'command-r',

  // GitHub Models — free GPT-4o-mini / Phi / etc. via a GitHub PAT. OpenAI-
  // compatible endpoint; model ids are publisher-qualified (openai/gpt-4o-mini).
  githubToken: process.env.GITHUB_TOKEN || '',
  githubModel: process.env.GITHUB_MODEL || 'openai/gpt-4o-mini',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',

  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',

  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1',

  // Public URL this server is reachable at — used to build the OAuth redirect
  // URI. Locally this is localhost; in production set it to the deployed URL.
  serverPublicUrl: process.env.SERVER_PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`,
  // Google OAuth — optional. When these are set, "Continue with Google" works;
  // when empty, the button returns a friendly "not configured yet" message.
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
};

config.googleEnabled = Boolean(config.googleClientId && config.googleClientSecret);

// Outbound email (password-reset links) — optional. When SMTP is set, reset
// emails send for real; when empty, the reset link is logged to the server
// console instead (dev fallback) so the flow is testable without an email account.
config.smtpHost = process.env.SMTP_HOST || '';
config.smtpPort = Number(process.env.SMTP_PORT || 587);
config.smtpUser = process.env.SMTP_USER || '';
config.smtpPass = process.env.SMTP_PASS || '';
config.smtpFrom = process.env.SMTP_FROM || 'Confero <no-reply@confero.app>';
config.emailEnabled = Boolean(config.smtpHost && config.smtpUser && config.smtpPass);

if (!config.groqApiKey) {
  console.warn('[config] GROQ_API_KEY is empty — /api endpoints will fail until it is set in server/.env');
}

module.exports = config;
