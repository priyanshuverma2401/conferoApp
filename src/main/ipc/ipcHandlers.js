const { ipcMain } = require('electron');
const appState = require('../state/appState');

function registerIpcHandlers({ overlayWin, indicatorWin, config }) {
  ipcMain.handle('stealth:get-state', () => ({ enabled: appState.stealthEnabled }));

  ipcMain.handle('config:get', () => ({
    productName: config.productName,
    llmProvider: config.llmProvider,
    ollamaModel: config.ollamaModel,
    claudeModel: config.claudeModel,
    whisperModel: config.whisperModel,
    stealthHotkey: config.stealthHotkey,
    silenceRmsThreshold: config.silenceRmsThreshold,
    trailingSilenceMs: config.trailingSilenceMs,
    maxUtteranceMs: config.maxUtteranceMs,
    minUtteranceMs: config.minUtteranceMs,
  }));

  ipcMain.handle('transcript:clear', () => {
    appState.transcript = [];
    appState.runningSummary = '';
    appState.lastQA = null;
    appState.sessionAnswers = [];
    appState.recentAnswers = [];
    return { ok: true };
  });

  // Audio/transcription/LLM handlers (audio:list-devices, audio:start-capture,
  // audio:stop-capture, audio:pcm-chunk) are registered by their respective modules
  // once those pipelines exist (see audioCaptureManager.js).
}

module.exports = { registerIpcHandlers };
