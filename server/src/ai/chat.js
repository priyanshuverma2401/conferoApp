const config = require('../config');

// ── One chat interface, every major provider wired, with automatic failover ──
// proxy.js calls chat(messages). It tries the primary provider (CHAT_PROVIDER)
// first; if that provider errors OR hangs (timeout), it automatically falls
// through the configured backups (CHAT_FALLBACKS) so a single provider outage
// never takes the app down mid-session. Switching primary or backups is a config
// change + push — never a code change. `messages` is the OpenAI-style array
// [{role:'system'|'user'|'assistant', content}].
//
// FREE / cheap:  groq (active), gemini, openrouter, cerebras, mistral, together, cohere
// LOCAL / free:  ollama
// PAID:          openai, anthropic
// Transcription always uses Groq Whisper (fast + cheap), separate from this.

// frequency_penalty discourages small models from spiraling into a repeated-
// phrase loop when they're uncertain (observed: llama-3.1-8b-instant repeating
// "called Penetration testing tool" dozens of times on an ambiguous question).
const CHAT_OPTS = { max_tokens: 300, temperature: 0.3, frequency_penalty: 0.4 };
// A hung/down provider fails this fast, then failover kicks in. 8s, not 15:
// in a live conversation a stalled answer is a dead answer — observed a hung
// primary pin the user at "Thinking..." for the full 15s before failing over.
const REQUEST_TIMEOUT_MS = 8000;

function timeout() {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

// The interviewer said the term correctly; only the transcription mangled it,
// so the candidate must NEVER correct them out loud. Strip any "I think you
// mean X" opener the model slips in despite instructions — a hard guarantee on
// top of the prompt, since it must never reach the candidate's mouth.
function stripCorrection(text) {
  return text
    // "I think you mean/are referring to X" — allowing hedge words in between
    // ("I think you may be referring to", "it sounds like you might mean").
    .replace(/\b(?:I think|I believe|I'm guessing|I suspect|it seems like|it sounds like|maybe|perhaps)\b[^.?!\n]{0,25}?\byou(?:'re| are|'d| would)?\s*(?:may be|might be|may|might)?\s*(?:mean|meant|referring to|thinking of|talking about|asking about)\b[^.?!;\n]*[.,;]?\s*/gi, '')
    // bare "you mean/may mean/are referring to X,"
    .replace(/\byou(?:'re| are)?\s*(?:probably|may|might)?\s*(?:mean|meant|referring to)\b[^.?!;\n]*[.,;]?\s*/gi, '')
    // If a SAY line was left starting lower-case after a strip, tidy it.
    .replace(/(SAY:\s*)([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// Small models love announcing their answer ("Here's a possible response:")
// even when told not to — for text that gets read ALOUD that's poison. Strip a
// short announce-style first line when real content follows it.
function stripPreamble(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1) {
    const first = lines[0].trim();
    if (
      first.length < 90 &&
      /^(here('|’)?s|here is|sure|certainly|okay|of course)\b/i.test(first) &&
      /(response|answer|reply|prompt|version|take)\s*:?\s*$/i.test(first)
    ) {
      return lines.slice(1).join('\n').trim();
    }
  }
  return text;
}

// Small models can spiral into repeating the same phrase when they're
// uncertain (observed: llama-3.1-8b-instant looping "is a mishearing of
// 'Penumbra' or possibly..." for the rest of its token budget). frequency_penalty
// alone doesn't reliably stop this, so this is a hard backstop: slide a 5-word
// window across the output, and the moment a window repeats one already seen,
// the text has started looping — cut it there (backing up to the nearest
// sentence end nearby, for a clean result) rather than showing the loop.
function stripRepetition(text) {
  const words = text.split(/\s+/);
  const N = 5;
  const seen = new Map();
  for (let i = 0; i + N <= words.length; i++) {
    const gram = words.slice(i, i + N).join(' ').toLowerCase();
    if (seen.has(gram)) {
      const cut = words.slice(0, i).join(' ');
      const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
      if (lastSentenceEnd > cut.length * 0.4) return cut.slice(0, lastSentenceEnd + 1).trim();
      return `${cut.trim()}…`; // no clean sentence break nearby — mark it as trimmed, not broken
    }
    seen.set(gram, i);
  }
  return text;
}

// Most providers speak the OpenAI chat-completions dialect — same shape, differ
// only by URL + key + model. One caller covers all of them.
// Every runner returns { text, model } so chat() can report which model
// actually produced the answer (for the live "which model" indicator).
async function openAiCompatible({ url, apiKey, model, extraHeaders = {} }, messages) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ model, messages, ...CHAT_OPTS }),
    signal: timeout(),
  });
  if (!res.ok) throw upstream(url, res);
  const data = await res.json();
  return { text: (data.choices?.[0]?.message?.content || '').trim(), model };
}

// ── OpenAI-dialect providers ────────────────────────────────────────────────
const groq = (m) => openAiCompatible({ url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: config.groqApiKey, model: config.groqChatModel }, m);
const openrouter = (m) => openAiCompatible({ url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: config.openrouterApiKey, model: config.openrouterModel }, m);
// Qwen3-Coder via OpenRouter's free tier — a purpose-built coding model, the
// best free option for DSA / algorithmic problems (DSA mode's preferred default).
// Free DeepSeek slugs were retired to paid; Qwen3-Coder is the free replacement.
// Same key as openrouter. It's often upstream-rate-limited, which is exactly why
// the DSA mode uses it as a SOFT preference with automatic fallback.
const qwencoder = (m) => openAiCompatible({ url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: config.openrouterApiKey, model: config.qwenCoderModel }, m);
const cerebras = (m) => openAiCompatible({ url: 'https://api.cerebras.ai/v1/chat/completions', apiKey: config.cerebrasApiKey, model: config.cerebrasModel }, m);
const mistral = (m) => openAiCompatible({ url: 'https://api.mistral.ai/v1/chat/completions', apiKey: config.mistralApiKey, model: config.mistralModel }, m);
const together = (m) => openAiCompatible({ url: 'https://api.together.xyz/v1/chat/completions', apiKey: config.togetherApiKey, model: config.togetherModel }, m);
const openai = (m) => openAiCompatible({ url: 'https://api.openai.com/v1/chat/completions', apiKey: config.openaiApiKey, model: config.openaiModel }, m);
const github = (m) => openAiCompatible({ url: 'https://models.github.ai/inference/chat/completions', apiKey: config.githubToken, model: config.githubModel }, m);

// ── Custom-dialect providers ────────────────────────────────────────────────
async function geminiModel(model, messages, apiKey) {
  const system = messages.find((m) => m.role === 'system');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: CHAT_OPTS.max_tokens,
      temperature: CHAT_OPTS.temperature,
      // No frequencyPenalty here — not all Gemini models accept it, and a 400
      // on the primary would silently dump every request to the weaker fallback.
      // Flash-tier models default to spending part of the token budget on
      // hidden "thinking" before answering. For a 1-3 sentence suggestion that
      // just burns the budget we need for the visible answer — observed
      // gemini-flash-latest (now aliasing gemini-3.5-flash) spend 284 tokens
      // thinking and return a 3-word answer truncated by maxOutputTokens.
      // Verified live: thinkingBudget 0 → finishReason STOP, full answer.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system.content }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout() });
  if (!res.ok) throw upstream(`Gemini ${model}`, res);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// Per-key exhaustion cache: a 429 means that key is out of daily quota, so we
// skip it for a cooldown instead of re-probing it on every request. This lets
// us rotate through ALL keys — using any that still has quota — while a
// newly-dead key is only probed once per cooldown window, keeping latency low.
// When every key is cooling down, gemini() throws fast and chat() moves to the
// next-best provider.
const keyCoolUntil = new Map();
// 90s ≈ the per-minute rate-limit reset, so a momentarily-throttled key comes
// back quickly rather than being benched for minutes.
const GEMINI_KEY_COOLDOWN_MS = 90 * 1000;
// Cap how many fresh keys a single answer probes, so one request never waits on
// all 15 dead keys (~8s). Cooled keys are skipped for free, and the rotation
// continues on the next request — so over a few answers every key still gets
// tried, just without any single answer paying the full sweep.
const GEMINI_MAX_PROBES = 4;

async function gemini(messages) {
  const models = [...new Set([config.geminiModel, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])];
  const keys = config.geminiApiKeys.length ? config.geminiApiKeys : [config.geminiApiKey];
  const now = Date.now();
  let lastErr;
  let probes = 0;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (keyCoolUntil.get(key) > now) continue; // known-throttled — skip for free
    if (probes >= GEMINI_MAX_PROBES) break; // bound per-answer latency
    probes += 1;
    for (const model of models) {
      try {
        const text = await geminiModel(model, messages, key);
        keyCoolUntil.delete(key); // this key is alive again
        const short = model.replace('gemini-', '').replace('-latest', '');
        const keyLabel = keys.length > 1 ? `key ${k + 1}/${keys.length}` : null;
        return { text, model: [short, keyLabel].filter(Boolean).join(' · ') };
      } catch (err) {
        lastErr = err;
        if (!/\(429\)/.test(err.message)) throw err; // real error — bubble up
        // Throttled: bench this key briefly and move to the next.
        keyCoolUntil.set(key, Date.now() + GEMINI_KEY_COOLDOWN_MS);
        break;
      }
    }
  }
  throw lastErr || new Error('All Gemini keys are cooling down (429)');
}

async function anthropic(messages) {
  const system = messages.find((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: CHAT_OPTS.max_tokens, system: system?.content, messages: conversation }),
    signal: timeout(),
  });
  if (!res.ok) throw upstream('Anthropic', res);
  const data = await res.json();
  return { text: (data.content?.[0]?.text || '').trim(), model: config.anthropicModel };
}

async function cohere(messages) {
  const res = await fetch('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.cohereApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.cohereModel, messages, max_tokens: CHAT_OPTS.max_tokens, temperature: CHAT_OPTS.temperature }),
    signal: timeout(),
  });
  if (!res.ok) throw upstream('Cohere', res);
  const data = await res.json();
  return { text: (data.message?.content?.[0]?.text || '').trim(), model: config.cohereModel };
}

async function ollama(messages) {
  const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ollamaModel, messages, stream: false }),
    signal: timeout(),
  });
  if (!res.ok) throw upstream('Ollama', res);
  const data = await res.json();
  return { text: (data.message?.content || '').trim(), model: config.ollamaModel };
}

function upstream(name, res) {
  return new Error(`Chat upstream failed via ${name} (${res.status})`);
}

// Registry: each provider has a runner and a `ready` check (has its key set).
// `ready` lets failover skip any backup that isn't actually configured.
const PROVIDERS = {
  groq: { run: groq, ready: () => Boolean(config.groqApiKey) },
  gemini: { run: gemini, ready: () => Boolean(config.geminiApiKey) },
  openrouter: { run: openrouter, ready: () => Boolean(config.openrouterApiKey) },
  qwencoder: { run: qwencoder, ready: () => Boolean(config.openrouterApiKey) },
  cerebras: { run: cerebras, ready: () => Boolean(config.cerebrasApiKey) },
  mistral: { run: mistral, ready: () => Boolean(config.mistralApiKey) },
  together: { run: together, ready: () => Boolean(config.togetherApiKey) },
  cohere: { run: cohere, ready: () => Boolean(config.cohereApiKey) },
  openai: { run: openai, ready: () => Boolean(config.openaiApiKey) },
  github: { run: github, ready: () => Boolean(config.githubToken) },
  anthropic: { run: anthropic, ready: () => Boolean(config.anthropicApiKey) },
  ollama: { run: ollama, ready: () => true },
};

// Providers ranked best → worst for this task (instruction-following + grounded,
// speakable answers). Paid frontier models top the list, so the moment a paid
// key is added it's used first automatically; then the best free model (Gemini
// Flash), then the free 70B-class hosts, then smaller/local last. This is the
// single source of truth for "sorted by best model" — the chain is just this
// list filtered to whichever providers actually have a key.
const QUALITY_ORDER = [
  'anthropic', // Claude — best if a paid key is set
  'openai',    // GPT-4o-mini class — paid
  'github',    // GitHub Models — free GPT-4o-mini
  'gemini',    // Gemini Flash — best free, own model sub-chain (flash → flash-lite)
  'cerebras',  // Llama 3.3 70B — fast, generous free tier
  'groq',      // Llama 3.3 70B — generous free tier
  'mistral',   // Mistral small — decent free
  'together',  // Llama 3.3 70B free
  'openrouter',// Qwen — many free models
  'qwencoder', // Qwen3-Coder via OpenRouter — strong at code/algorithms
  'cohere',    // Command-R
  'ollama',    // local, last resort
];

// Try providers in quality order (best available first), skipping any without a
// key, and falling through on 429/timeout/error. An optional CHAT_PROVIDER just
// pins one provider to the very front; everything else stays quality-ordered.
async function chat(messages, { forceProvider, preferProvider } = {}) {
  // forceProvider (from the in-app model picker) is STRICT — only that model, no
  // silent fallback — so testing a model actually tests THAT model. If it's
  // rate-limited you get a clear error, never a different model's answer (that's
  // why the badge used to "always show GPT"). preferProvider (from the active
  // mode, e.g. DSA → DeepSeek) is SOFT — pinned to the front but with normal
  // failover, so a coding model is tried first yet you always get an answer.
  // Otherwise honour CHAT_PROVIDER / CHAT_STRICT / quality order with failover.
  const ranked = forceProvider
    ? [forceProvider]
    : preferProvider
      ? [preferProvider, ...QUALITY_ORDER]
      : config.chatStrict && config.chatProvider
        ? [config.chatProvider]
        : config.chatProvider
          ? [config.chatProvider, ...QUALITY_ORDER]
          : QUALITY_ORDER;
  const chain = ranked.filter((n, i, a) => a.indexOf(n) === i);
  const attempts = []; // per-provider trace for the QA log
  const t0 = Date.now();
  let lastErr;
  for (const name of chain) {
    const p = PROVIDERS[name];
    if (!p || !p.ready()) { if (p) attempts.push({ provider: name, skipped: 'no key' }); continue; }
    const s = Date.now();
    try {
      const { text, model } = await p.run(messages);
      attempts.push({ provider: name, ms: Date.now() - s, ok: true, model });
      // The spoken-answer cleaners (preamble/repetition strippers) would mangle
      // code — a for-loop legitimately repeats tokens, and "def solve(" reads like
      // a preamble. If the response carries a code fence, leave it intact.
      const cleaned = /```/.test(text) ? text.trim() : stripCorrection(stripRepetition(stripPreamble(text)));
      return {
        text: cleaned,
        provider: PROVIDER_LABELS[name] || name,
        detail: model,
        ms: Date.now() - t0,
        attempts,
      };
    } catch (err) {
      attempts.push({ provider: name, ms: Date.now() - s, ok: false, error: err.message });
      lastErr = err;
      console.warn(`[chat] provider "${name}" failed (${err.message}) — failing over to next best`);
    }
  }
  const err = lastErr || new Error('No chat provider is configured.');
  err.attempts = attempts; // so the proxy/app can log the failed attempts too
  throw err;
}

// Friendly names for the live "which model" indicator.
const PROVIDER_LABELS = {
  gemini: 'Gemini', groq: 'Groq', cerebras: 'Cerebras', mistral: 'Mistral',
  together: 'Together', openrouter: 'Qwen', qwencoder: 'Qwen-Coder', cohere: 'Cohere',
  openai: 'OpenAI', github: 'GPT-4o-mini', anthropic: 'Claude', ollama: 'Ollama',
};

module.exports = { chat, PROVIDERS };
