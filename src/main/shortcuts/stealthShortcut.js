const { globalShortcut } = require('electron');
const appState = require('../state/appState');

function registerStealthToggle(overlayWin, indicatorWin, accelerator) {
  const ok = globalShortcut.register(accelerator, () => {
    appState.stealthEnabled = !appState.stealthEnabled;

    // Toggle content-protection state, not window visibility — Electron has a known
    // bug where hide()/show() on a protected window can render as solid black in
    // captures instead of properly excluding it.
    overlayWin.setContentProtection(appState.stealthEnabled);

    // WDA_EXCLUDEFROMCAPTURE changes can lag behind until the window surface is
    // touched again — nudge the compositor with a no-op bounds set so the new
    // protection state actually applies immediately instead of on next redraw.
    overlayWin.setBounds(overlayWin.getBounds());

    console.log(`[stealth] toggled -> ${appState.stealthEnabled ? 'ON' : 'OFF'}`);

    const payload = { enabled: appState.stealthEnabled };
    overlayWin.webContents.send('stealth:state-changed', payload);
    indicatorWin.webContents.send('stealth:state-changed', payload);
  });

  if (!ok) {
    console.error(`Failed to register global shortcut: ${accelerator} (already in use by another app?)`);
  }

  return ok;
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = { registerStealthToggle, unregisterAll };
