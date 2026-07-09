const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const { writeWavFile } = require('./wavWriter');
const appState = require('../state/appState');

// Must be a real writable OS location, not a path derived from __dirname — in a
// packaged build __dirname resolves inside app.asar, which is a single archive
// file, not a real directory, so mkdir/writeFile against a path "inside" it
// fails with ENOTDIR. These are genuinely temporary files (deleted immediately
// after transcription), so the OS temp directory is the natural fit.
const RECORDINGS_DIR = path.join(app.getPath('temp'), 'confero-recordings');

function ensureRecordingsDir() {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }
}

// Registers the IPC surface the renderer-side capture code talks to. The actual
// getUserMedia/getDisplayMedia capture happens in the renderer (browser APIs);
// this module just receives finished PCM chunks and writes them to disk.
function registerAudioHandlers({ onChunkWritten, isBlocked, onSessionStart } = {}) {
  ensureRecordingsDir();

  ipcMain.handle('audio:start-capture', () => {
    // Guardrail: never start capturing while proctoring software is present.
    const blockedBy = isBlocked && isBlocked();
    if (blockedBy) {
      return { ok: false, blocked: true, reason: `Confero is disabled while proctoring software is running (${blockedBy}).` };
    }
    appState.capturing = true;
    if (onSessionStart) onSessionStart(); // fresh session: reset per-session counters/thread state
    return { ok: true };
  });

  ipcMain.handle('audio:stop-capture', () => {
    appState.capturing = false;
    return { ok: true };
  });

  ipcMain.handle('audio:list-devices', () => {
    // System audio uses getDisplayMedia loopback (no device picker needed).
    // Mic uses the default getUserMedia input. No device enumeration required yet.
    return [];
  });

  ipcMain.on('audio:pcm-chunk', async (_event, { source, buffer, sampleRate }) => {
    // Guardrail: drop any audio that arrives while proctoring software is present.
    if (isBlocked && isBlocked()) return;
    const int16Samples = new Int16Array(buffer);
    const filename = `${source}_${Date.now()}.wav`;
    const filePath = path.join(RECORDINGS_DIR, filename);
    await writeWavFile(filePath, int16Samples, sampleRate);
    if (onChunkWritten) onChunkWritten({ source, filePath, sampleRate });
  });
}

module.exports = { registerAudioHandlers, RECORDINGS_DIR };
