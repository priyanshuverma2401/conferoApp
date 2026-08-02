const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settings-panel');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const rawInstructionsInput = document.getElementById('rawInstructionsInput');
const generatedPromptPreview = document.getElementById('generatedPromptPreview');
const generatePromptBtn = document.getElementById('generatePromptBtn');
const savePromptBtn = document.getElementById('savePromptBtn');
const vocabularyHintsInput = document.getElementById('vocabularyHintsInput');
const saveVocabularyBtn = document.getElementById('saveVocabularyBtn');
const documentEmptyState = document.getElementById('documentEmptyState');
const documentCard = document.getElementById('documentCard');
const documentFileName = document.getElementById('documentFileName');
const documentUploadedAt = document.getElementById('documentUploadedAt');
const documentSummary = document.getElementById('documentSummary');
const uploadDocumentBtn = document.getElementById('uploadDocumentBtn');
const removeDocumentBtn = document.getElementById('removeDocumentBtn');
const settingsStatus = document.getElementById('settingsStatus');

// ── Theme switcher ──────────────────────────────────────────────────────────
// Themes are pure presentation (CSS-variable sets keyed by data-theme on <html>),
// so they persist in localStorage — no backend/settings round-trip. The saved
// theme is applied pre-paint by an inline script in index.html to avoid a flash;
// here we just keep the swatch UI in sync and handle switching live.
const THEMES = ['default', 'matrix'];
const themePicker = document.getElementById('themePicker');
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme') || 'default';
  return THEMES.includes(t) ? t : 'default';
}
function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : 'default';
  if (theme === 'default') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('confero-theme', theme); } catch (e) { /* private mode */ }
  if (themePicker) {
    themePicker.querySelectorAll('.theme-swatch').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
  }
}
if (themePicker) {
  themePicker.querySelectorAll('.theme-swatch').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.theme));
  });
  applyTheme(currentTheme()); // sync active swatch to whatever the inline script set
}

// ── Reading-font switcher ───────────────────────────────────────────────────
// Same shape as the theme switcher above: pure presentation, localStorage only,
// applied pre-paint by the inline script in index.html so there's no flash of the
// previous face. It overrides --reading-font, which is the ONE variable every
// reading surface (question, answer, take-2, up-next, transcript) draws from —
// so a choice here reaches all of them and nothing else.
// The SF entries lead with -apple-system/BlinkMacSystemFont, which is how you ask
// for San Francisco by name — Apple doesn't ship it as an installable family and
// it can't be bundled. On a Mac all three resolve to SF (Text and Display are its
// optical sizes); on Windows they fall through to Segoe UI, which is that
// platform's equivalent UI face rather than a lookalike.
const FONTS = {
  default: '', // clears the override — the stylesheet's San Francisco stack
  sfprotext: '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  sfprodisplay: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: '"Tiempos Text", "Tiempos Headline", Tiempos, Georgia, "Iowan Old Style", "Source Serif Pro", "Times New Roman", serif',
  consolas: 'Consolas, "Lucida Console", monospace',
  courier: '"Courier New", Courier, monospace',
  mono: 'monospace',
};
// San Francisco IS the default now, so an older saved 'sanfrancisco' means the
// same thing — map it over rather than leaving the dropdown showing blank.
const FONT_ALIASES = { sanfrancisco: 'default' };
const fontPicker = document.getElementById('fontPicker');
function applyReadingFont(name) {
  const asked = FONT_ALIASES[name] || name;
  const key = Object.prototype.hasOwnProperty.call(FONTS, asked) ? asked : 'default';
  const stack = FONTS[key];
  if (stack) document.documentElement.style.setProperty('--reading-font', stack);
  else document.documentElement.style.removeProperty('--reading-font');
  try { localStorage.setItem('confero-font', key); } catch (e) { /* private mode */ }
  if (fontPicker && fontPicker.value !== key) fontPicker.value = key;
}
if (fontPicker) {
  // Each row previews itself — "Consolas" and "Courier New" are indistinguishable
  // as plain labels, and the SF entries only differ by their optical size.
  Array.from(fontPicker.options).forEach((o) => {
    if (FONTS[o.value]) o.style.fontFamily = FONTS[o.value];
  });
  fontPicker.addEventListener('change', () => applyReadingFont(fontPicker.value));
  let saved = 'default';
  try { saved = localStorage.getItem('confero-font') || 'default'; } catch (e) { /* private mode */ }
  applyReadingFont(saved);
}

function renderDocumentInfo(documentContext) {
  if (documentContext) {
    documentFileName.textContent = documentContext.fileName;
    documentUploadedAt.textContent = `Uploaded ${new Date(documentContext.uploadedAt).toLocaleString()}`;
    documentSummary.textContent = documentContext.summary;
    documentEmptyState.style.display = 'none';
    documentCard.style.display = '';
  } else {
    documentEmptyState.style.display = '';
    documentCard.style.display = 'none';
  }
}

function setStatus(text) {
  settingsStatus.textContent = text;
}

async function openSettingsPanel() {
  settingsPanel.classList.remove('hidden');
  const settings = await window.stealthAPI.getUserSettings();
  rawInstructionsInput.value = settings.rawInstructions || '';
  generatedPromptPreview.value = settings.generatedSystemPrompt || '';
  vocabularyHintsInput.value = settings.vocabularyHints || '';
  // Documents are per-mode, so show the active mode's — and say which one.
  const activeMode = settings.activeMode || 'tutoring';
  const modes = await window.stealthAPI.listModes();
  const label = (modes.find((m) => m.id === activeMode) || {}).label || activeMode;
  const documentLabel = document.getElementById('documentLabel');
  if (documentLabel) documentLabel.textContent = `Background document for ${label} (resume/bio/reference)`;
  renderDocumentInfo((settings.documentContext || {})[activeMode]);
  savePromptBtn.disabled = !generatedPromptPreview.value;
  setStatus('');
}

function closeSettingsPanel() {
  settingsPanel.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettingsPanel);
settingsCloseBtn.addEventListener('click', closeSettingsPanel);

generatePromptBtn.addEventListener('click', async () => {
  const rawText = rawInstructionsInput.value.trim();
  if (!rawText) {
    setStatus('Type some instructions first.');
    return;
  }

  generatePromptBtn.disabled = true;
  generatePromptBtn.textContent = 'Generating...';
  setStatus('');

  try {
    const { generatedSystemPrompt } = await window.stealthAPI.generateSystemPrompt(rawText);
    generatedPromptPreview.value = generatedSystemPrompt;
    savePromptBtn.disabled = !generatedSystemPrompt;
    setStatus('Preview ready — review it, then Save to apply.');
  } catch (err) {
    setStatus(`Failed to generate: ${err.message}`);
  } finally {
    generatePromptBtn.disabled = false;
    generatePromptBtn.textContent = 'Generate';
  }
});

savePromptBtn.addEventListener('click', async () => {
  const rawText = rawInstructionsInput.value.trim();
  const generatedText = generatedPromptPreview.value.trim();
  if (!generatedText) return;

  savePromptBtn.disabled = true;
  try {
    await window.stealthAPI.saveSystemPrompt(rawText, generatedText);
    setStatus('Saved — takes effect on the next suggestion.');
  } catch (err) {
    setStatus(`Failed to save: ${err.message}`);
  } finally {
    savePromptBtn.disabled = false;
  }
});

saveVocabularyBtn.addEventListener('click', async () => {
  const hints = vocabularyHintsInput.value.trim();
  saveVocabularyBtn.disabled = true;
  try {
    await window.stealthAPI.saveVocabularyHints(hints);
    setStatus('Vocabulary hints saved — applies to the next transcription.');
  } catch (err) {
    setStatus(`Failed to save hints: ${err.message}`);
  } finally {
    saveVocabularyBtn.disabled = false;
  }
});

uploadDocumentBtn.addEventListener('click', async () => {
  uploadDocumentBtn.disabled = true;
  uploadDocumentBtn.textContent = 'Processing...';
  setStatus('');

  try {
    const result = await window.stealthAPI.pickDocument();
    console.log('[document] pick result:', JSON.stringify(result).slice(0, 200));
    if (result.canceled) {
      setStatus('No file selected.');
      return;
    }
    if (!result.success) {
      setStatus(`Failed to process document: ${result.error}`);
      return;
    }
    renderDocumentInfo(result.documentContext);
    setStatus('Document uploaded — used as context in future suggestions.');
  } catch (err) {
    console.error('[document] upload failed:', err);
    setStatus(`Failed to process document: ${err.message}`);
  } finally {
    uploadDocumentBtn.disabled = false;
    uploadDocumentBtn.textContent = 'Upload document';
  }
});

removeDocumentBtn.addEventListener('click', async () => {
  removeDocumentBtn.disabled = true;
  try {
    await window.stealthAPI.removeDocument();
    renderDocumentInfo(null);
    setStatus('Document removed.');
  } catch (err) {
    setStatus(`Failed to remove document: ${err.message}`);
  } finally {
    removeDocumentBtn.disabled = false;
  }
});

// ── Account / sign out ──
// Sign out relaunches the app into the sign-in window, so it gets a confirm
// step: a mis-click here ends the session, and the only way back is logging in
// again. The email comes from the cached /api/me response, so it still shows
// offline; without it the row just says "Signed in" rather than lying.
(function initAccount() {
  const emailEl = document.getElementById('accountEmail');
  const planEl = document.getElementById('accountPlan');
  const btn = document.getElementById('signOutBtn');
  const confirm = document.getElementById('signOutConfirm');
  const cancel = document.getElementById('signOutCancel');
  const go = document.getElementById('signOutGo');
  if (!btn) return;

  window.stealthAPI.getAccount().then((acct) => {
    if (acct && acct.email) emailEl.textContent = acct.email;
    if (acct && acct.plan) planEl.textContent = acct.plan === 'premium' ? 'Premium' : 'Free plan';
  }).catch(() => { /* the row's defaults already read correctly */ });

  btn.addEventListener('click', () => {
    confirm.classList.remove('hidden');
    btn.classList.add('hidden');
    // The account row is the last thing in a scrolling panel, so the confirm
    // opens below the fold — without this the click looks like it did nothing.
    confirm.scrollIntoView({ block: 'nearest' });
  });
  cancel.addEventListener('click', () => {
    confirm.classList.add('hidden');
    btn.classList.remove('hidden');
  });

  go.addEventListener('click', async () => {
    go.disabled = true;
    cancel.disabled = true;
    go.textContent = 'Signing out…';
    try {
      // Stop the microphone the same way "End session" does — main archives the
      // transcript, but it can't tear down the renderer's audio graph.
      if (window.__conferoStopCapture) await window.__conferoStopCapture();
      const res = await window.stealthAPI.signOut();
      // A successful sign-out relaunches, so reaching here means it failed.
      if (res && res.error) throw new Error(res.error);
    } catch (err) {
      go.disabled = false;
      cancel.disabled = false;
      go.textContent = 'Sign out';
      setStatus(`Couldn't sign out: ${err.message}`);
    }
  });
}());
