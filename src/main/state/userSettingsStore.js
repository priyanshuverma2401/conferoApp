const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Persisted subset of app state (survives restarts), separate from appState.js
// which is explicitly in-memory-only by design. Single JSON file shared by the
// custom-system-prompt and document-upload features since both are "persisted
// user settings" configured once via the settings panel.
//
// Lives under userData (a real writable per-user OS directory), not a path
// derived from __dirname — in a packaged build __dirname resolves inside
// app.asar, which is a single archive file, not a real directory, so writing
// "into" it fails with ENOTDIR. This also means settings persist consistently
// whether running via `npm start` or the packaged exe.
const SETTINGS_PATH = path.join(app.getPath('userData'), 'user-settings.json');

const DEFAULTS = {
  generatedSystemPrompt: null,
  rawInstructions: null,
  // Per-mode so a resume attached for the interview persona doesn't leak into
  // tutoring, etc. Shape: { [modeId]: { fileName, summary, uploadedAt } }.
  documentContext: {},
  vocabularyHints: null, // free-text list of domain terms/proper nouns to bias transcription toward
  activeMode: 'tutoring', // selected preset id (from modes.js); set by onboarding persona
  modeContext: {}, // { [modeId]: text } — e.g. job title/description for Interview, topic for a talk
};

let cache = { ...DEFAULTS };

async function loadUserSettings() {
  try {
    let raw = await fs.promises.readFile(SETTINGS_PATH, 'utf-8');
    // Strip a UTF-8 BOM if present — JSON.parse throws on a leading BOM, and a
    // parse failure here used to silently drop ALL saved data (context, docs)
    // and let the next save overwrite the file with empty defaults.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
    // Migrate a legacy global document (flat { fileName, ... }) into the
    // per-mode shape, attributing it to whatever mode was active when saved.
    if (cache.documentContext && cache.documentContext.fileName) {
      cache.documentContext = { [cache.activeMode || 'interview']: cache.documentContext };
    }
    if (!cache.documentContext || typeof cache.documentContext !== 'object') cache.documentContext = {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[userSettingsStore] failed to load settings:', err.message);
      // Never let unreadable data get silently overwritten — preserve a copy so
      // the user's context/documents are recoverable instead of lost forever.
      try {
        await fs.promises.copyFile(SETTINGS_PATH, `${SETTINGS_PATH}.corrupt-${Date.now()}`);
      } catch (_) { /* best effort */ }
    }
    cache = { ...DEFAULTS };
  }
  return cache;
}

async function saveUserSettings(partialUpdate) {
  cache = { ...cache, ...partialUpdate };
  const dir = path.dirname(SETTINGS_PATH);
  await fs.promises.mkdir(dir, { recursive: true });
  // Write-then-rename so a crash mid-write never leaves a torn/corrupt file.
  const tmpPath = `${SETTINGS_PATH}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(cache, null, 2));
  await fs.promises.rename(tmpPath, SETTINGS_PATH);
  return cache;
}

function getCachedSettings() {
  return cache;
}

module.exports = { loadUserSettings, saveUserSettings, getCachedSettings };
