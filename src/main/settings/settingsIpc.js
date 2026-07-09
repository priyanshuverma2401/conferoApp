const { ipcMain, dialog } = require('electron');
const userSettingsStore = require('../state/userSettingsStore');
const { buildMetaPrompt, buildDocumentSummaryPrompt } = require('../llm/promptBuilder');
const { extractText } = require('../documents/documentExtractor');

// A resume/bio-data form doesn't need summarizing — skip the LLM call for the
// common short-input case and just store it verbatim.
const SUMMARY_SKIP_THRESHOLD = 1000;

// Settings-panel IPC surface: custom system prompt, vocabulary hints, and
// document-upload channels all live together since they're all "persisted
// settings configured once via the settings panel."
function registerSettingsHandlers({ llmClient, overlayWin }) {
  ipcMain.handle('settings:get', () => userSettingsStore.getCachedSettings());

  ipcMain.handle('settings:generate-system-prompt', async (_event, rawInstructions) => {
    const generated = await llmClient.getCompletion({
      systemPrompt: 'You output only the requested text, nothing else.',
      userPrompt: buildMetaPrompt(rawInstructions),
    });
    return { generatedSystemPrompt: generated };
  });

  ipcMain.handle('settings:save-system-prompt', async (_event, { rawInstructions, generatedSystemPrompt }) => {
    await userSettingsStore.saveUserSettings({ rawInstructions, generatedSystemPrompt });
    return { ok: true };
  });

  ipcMain.handle('settings:save-vocabulary-hints', async (_event, vocabularyHints) => {
    await userSettingsStore.saveUserSettings({ vocabularyHints });
    return { ok: true };
  });

  // Per-mode session context (e.g. job description for Interview, topic for a
  // talk) — set once before a session so the AI has real grounding instead of
  // guessing blind from the transcript alone.
  ipcMain.handle('settings:save-mode-context', async (_event, { modeId, text }) => {
    const modeContext = { ...(userSettingsStore.getCachedSettings().modeContext || {}), [modeId]: text };
    await userSettingsStore.saveUserSettings({ modeContext });
    return { ok: true };
  });

  ipcMain.handle('document:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(overlayWin, {
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['txt', 'pdf', 'docx'] }],
    });
    if (canceled || filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = filePaths[0];
    const fileName = filePath.split(/[\\/]/).pop();

    try {
      const rawText = await extractText(filePath);
      const trimmed = rawText.trim();

      const summary =
        trimmed.length < SUMMARY_SKIP_THRESHOLD
          ? trimmed
          : await llmClient.getCompletion({
              systemPrompt: 'You output only the requested summary, nothing else.',
              userPrompt: buildDocumentSummaryPrompt(trimmed),
            });

      const doc = { fileName, summary, uploadedAt: Date.now() };
      const settings = userSettingsStore.getCachedSettings();
      const activeMode = settings.activeMode || 'tutoring';
      const documentContext = { ...(settings.documentContext || {}), [activeMode]: doc };
      await userSettingsStore.saveUserSettings({ documentContext });
      return { success: true, documentContext: doc }; // single doc for the UI
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('document:remove', async () => {
    const settings = userSettingsStore.getCachedSettings();
    const activeMode = settings.activeMode || 'tutoring';
    const documentContext = { ...(settings.documentContext || {}) };
    delete documentContext[activeMode];
    await userSettingsStore.saveUserSettings({ documentContext });
    return { ok: true };
  });

  // Wipe the "sticky" AI setup that isn't obviously tied to a document — the
  // saved custom instructions and vocabulary hints. These persist across
  // sessions and personas, so a setup made for one use case silently leaks into
  // an unrelated one; this is the one-click reset for that.
  ipcMain.handle('settings:clear-ai-setup', async () => {
    await userSettingsStore.saveUserSettings({
      generatedSystemPrompt: null,
      rawInstructions: null,
      vocabularyHints: null,
    });
    return { ok: true };
  });
}

module.exports = { registerSettingsHandlers };
