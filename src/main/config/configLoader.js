const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Single source of truth for the product name — everything else (window titles,
// error dialogs, installer name) reads from here or from package.json directly,
// so renaming the product later is a one-line change.
const PRODUCT_NAME = require('../../../package.json').build.productName;

// In dev, .env lives at the project root and is gitignored. In a packaged build
// it must NOT be bundled into the installer image (that would permanently embed
// the API keys in every copy of the distributable) — instead it's read from the
// per-user, per-machine userData directory, which the user populates once after
// installing. .env.example (no secrets) ships in the package as a first-run
// template so the app can point them at a starting file instead of failing blind.
function resolveEnvPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, '../../../.env');
  }

  const userEnvPath = path.join(app.getPath('userData'), '.env');
  if (!fs.existsSync(userEnvPath)) {
    const bundledExamplePath = path.join(process.resourcesPath, '.env.example');
    try {
      if (fs.existsSync(bundledExamplePath)) {
        fs.copyFileSync(bundledExamplePath, userEnvPath);
      }
    } catch (err) {
      console.error('[configLoader] could not seed a starter .env file:', err.message);
    }
  }
  return userEnvPath;
}

const ENV_PATH = resolveEnvPath();
require('dotenv').config({ path: ENV_PATH });

function loadConfig() {
  const config = {
    productName: PRODUCT_NAME,
    // 'backend' (default) routes AI through Confero's own server so end users
    // never handle an API key. 'groq'/'ollama'/'claude' are direct/BYOK modes
    // for development or advanced users.
    llmProvider: process.env.LLM_PROVIDER || 'backend',
    transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || 'backend',
    backendUrl: process.env.CONFERO_BACKEND_URL || 'http://localhost:8787',

    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_K_M',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-haiku-4-5',

    groqApiKey: process.env.GROQ_API_KEY || '',
    groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
    groqChatModel: process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant',

    audioSlidingWindowMs: Number(process.env.AUDIO_SLIDING_WINDOW_MS || 8000),
    audioSlideIntervalMs: Number(process.env.AUDIO_SLIDE_INTERVAL_MS || 4000),

    silenceRmsThreshold: Number(process.env.SILENCE_RMS_THRESHOLD || 300),
    // Generous enough to tolerate a natural thinking-pause mid-sentence (~1s)
    // without splitting the utterance; still short enough to feel responsive
    // once someone actually stops talking.
    trailingSilenceMs: Number(process.env.TRAILING_SILENCE_MS || 1500),
    // Kept close to the old fixed-chunk cadence (5s) — a much higher cap (e.g.
    // 18s) meant a continuous talker saw no transcript at all for up to 18
    // seconds, which measured as a severe latency regression. This bounds
    // worst-case wait time and upload/transcribe size for continuous speech,
    // while trailingSilenceMs above still lets natural pauses end an utterance
    // early rather than waiting for this cap.
    maxUtteranceMs: Number(process.env.MAX_UTTERANCE_MS || 7000),
    minUtteranceMs: Number(process.env.MIN_UTTERANCE_MS || 400),

    stealthHotkey: process.env.STEALTH_HOTKEY || 'CommandOrControl+Shift+H',
    suggestionIntervalMs: Number(process.env.SUGGESTION_INTERVAL_MS || 18000),
  };

  if (config.llmProvider === 'claude' && !config.anthropicApiKey) {
    throw new Error(
      `LLM_PROVIDER is set to "claude" but ANTHROPIC_API_KEY is empty in ${ENV_PATH}. ` +
      'Add a key from console.anthropic.com, or set LLM_PROVIDER=ollama.'
    );
  }

  if ((config.llmProvider === 'groq' || config.transcriptionProvider === 'groq') && !config.groqApiKey) {
    throw new Error(
      `LLM_PROVIDER or TRANSCRIPTION_PROVIDER is set to "groq" but GROQ_API_KEY is empty in ${ENV_PATH}. ` +
      'Add a key from console.groq.com.'
    );
  }

  return config;
}

// Non-throwing check used at launch to decide whether to show onboarding or go
// straight to the app. In backend mode (default) "complete" means the user has
// signed in (a session token exists). In direct/BYOK modes it means the chosen
// provider has its key.
function isSetupComplete() {
  const provider = process.env.LLM_PROVIDER || 'backend';
  const transcription = process.env.TRANSCRIPTION_PROVIDER || 'backend';

  if (provider === 'backend' || transcription === 'backend') {
    const sessionStore = require('../state/sessionStore');
    return sessionStore.hasSession();
  }

  const needsGroq = provider === 'groq' || transcription === 'groq';
  const needsClaude = provider === 'claude';
  if (needsGroq && !(process.env.GROQ_API_KEY || '').trim()) return false;
  if (needsClaude && !(process.env.ANTHROPIC_API_KEY || '').trim()) return false;
  return true;
}

// Upsert a single KEY=value line in the .env file, preserving the rest of the
// file (comments, other keys) untouched. Also updates the in-memory process.env
// so a freshly-entered key takes effect without an app restart.
function setEnvValue(key, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const prefix = `${key}=`;
  let found = false;
  lines = lines.map((line) => {
    if (line.trimStart().startsWith(prefix)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) lines.push(`${key}=${value}`);

  fs.writeFileSync(ENV_PATH, lines.join('\n'));
  process.env[key] = value;
}

module.exports = { loadConfig, isSetupComplete, setEnvValue, ENV_PATH, PRODUCT_NAME };
