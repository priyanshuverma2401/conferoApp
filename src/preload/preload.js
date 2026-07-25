const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stealthAPI', {
  getStealthState: () => ipcRenderer.invoke('stealth:get-state'),
  onStealthStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('stealth:state-changed', listener);
    return () => ipcRenderer.removeListener('stealth:state-changed', listener);
  },

  onTranscriptChunk: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('transcript:chunk', listener);
    return () => ipcRenderer.removeListener('transcript:chunk', listener);
  },
  onSuggestionUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('suggestions:update', listener);
    return () => ipcRenderer.removeListener('suggestions:update', listener);
  },
  onAppError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:error', listener);
    return () => ipcRenderer.removeListener('app:error', listener);
  },
  onGuardrailBlocked: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('guardrail:blocked', listener);
    return () => ipcRenderer.removeListener('guardrail:blocked', listener);
  },
  onGuardrailCleared: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('guardrail:cleared', listener);
    return () => ipcRenderer.removeListener('guardrail:cleared', listener);
  },

  listAudioDevices: () => ipcRenderer.invoke('audio:list-devices'),
  startCapture: (deviceIds) => ipcRenderer.invoke('audio:start-capture', deviceIds),
  stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),
  sendPcmChunk: (source, buffer, sampleRate) =>
    ipcRenderer.send('audio:pcm-chunk', { source, buffer, sampleRate }),

  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  closeApp: () => ipcRenderer.send('app:quit'),

  getUserSettings: () => ipcRenderer.invoke('settings:get'),
  generateSystemPrompt: (rawInstructions) =>
    ipcRenderer.invoke('settings:generate-system-prompt', rawInstructions),
  saveSystemPrompt: (rawInstructions, generatedSystemPrompt) =>
    ipcRenderer.invoke('settings:save-system-prompt', { rawInstructions, generatedSystemPrompt }),
  saveVocabularyHints: (vocabularyHints) =>
    ipcRenderer.invoke('settings:save-vocabulary-hints', vocabularyHints),
  saveModeContext: (modeId, text) => ipcRenderer.invoke('settings:save-mode-context', { modeId, text }),

  pickDocument: () => ipcRenderer.invoke('document:pick'),
  removeDocument: () => ipcRenderer.invoke('document:remove'),
  clearSavedAiSetup: () => ipcRenderer.invoke('settings:clear-ai-setup'),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  startSignin: () => ipcRenderer.invoke('onboarding:start-signin'),
  completeOnboarding: () => ipcRenderer.invoke('onboarding:complete'),

  helpNow: () => ipcRenderer.invoke('assist:help-now'),
  recap: () => ipcRenderer.invoke('assist:recap'),
  rephrase: (text) => ipcRenderer.invoke('assist:rephrase', { text }),

  // Code Assist workspace (DSA / LLD)
  solveProblem: (problem, instruction) => ipcRenderer.invoke('assist:solve-problem', { problem, instruction }),
  codeFollowup: (question) => ipcRenderer.invoke('assist:code-followup', { question }),
  getActiveProblem: () => ipcRenderer.invoke('assist:get-problem'),
  clearActiveProblem: () => ipcRenderer.invoke('assist:clear-problem'),

  // Snip → OCR. snipQuestion() (Code Assist) opens the selector and resolves with
  // { text } | { cancelled } | { error }. snipRegion/snipCancel are used BY the
  // selector overlay window to report the dragged rectangle.
  snipQuestion: () => ipcRenderer.invoke('snip:start'),
  snipRegion: (rect) => ipcRenderer.send('snip:region', rect),
  snipCancel: () => ipcRenderer.send('snip:cancel'),
  onCodeAnswer: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('code:answer', listener);
    return () => ipcRenderer.removeListener('code:answer', listener);
  },
  listModes: () => ipcRenderer.invoke('modes:list'),
  getActiveMode: () => ipcRenderer.invoke('modes:get-active'),
  setActiveMode: (id) => ipcRenderer.invoke('modes:set-active', id),

  setModel: (provider) => ipcRenderer.invoke('model:set', provider),
  getAccount: () => ipcRenderer.invoke('account:get'),
  startUpgrade: () => ipcRenderer.invoke('billing:start-upgrade'),
  onPlanChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('account:plan', listener);
    return () => ipcRenderer.removeListener('account:plan', listener);
  },

  onAnswerListening: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('answer:listening', listener);
    return () => ipcRenderer.removeListener('answer:listening', listener);
  },
  onAnswerPending: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('answer:pending', listener);
    return () => ipcRenderer.removeListener('answer:pending', listener);
  },
  onAnswerQuick: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('answer:quick', listener);
    return () => ipcRenderer.removeListener('answer:quick', listener);
  },

  archiveAndResetSession: () => ipcRenderer.invoke('sessions:archive-and-reset'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  onAnswerReady: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('answer:ready', listener);
    return () => ipcRenderer.removeListener('answer:ready', listener);
  },
  onAnswerUpNext: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('answer:upnext', listener);
    return () => ipcRenderer.removeListener('answer:upnext', listener);
  },
});
