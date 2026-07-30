const { globalShortcut } = require('electron');
const appState = require('../state/appState');

// "Hide from screen share" in the UI — content protection under the hood. The
// user-facing wording deliberately avoids "stealth": most customers aren't
// technical, and "hidden from screen share" says exactly what the switch does.
// Both entry points (the global hotkey and the header toggle) funnel through
// applyScreenShareHidden, so the window, the indicator pill and the overlay UI
// can never drift out of sync.
// `source` travels with the state-changed event so the renderer can tell a
// user-initiated flip (worth an on-screen banner) from the silent one at startup
// that just restores the saved preference.
function applyScreenShareHidden(overlayWin, indicatorWin, enabled, source) {
  appState.stealthEnabled = enabled;

  // Toggle content-protection state, not window visibility — Electron has a known
  // bug where hide()/show() on a protected window can render as solid black in
  // captures instead of properly excluding it.
  overlayWin.setContentProtection(enabled);

  // WDA_EXCLUDEFROMCAPTURE changes can lag behind until the window surface is
  // touched again — nudge the compositor with a no-op bounds set so the new
  // protection state actually applies immediately instead of on next redraw.
  overlayWin.setBounds(overlayWin.getBounds());

  console.log(`[screen-share] hidden -> ${enabled ? 'ON' : 'OFF'}`);

  const payload = { enabled, source: source || 'system' };
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('stealth:state-changed', payload);
  if (indicatorWin && !indicatorWin.isDestroyed()) indicatorWin.webContents.send('stealth:state-changed', payload);
  return enabled;
}

// `onToggle(want)` lets main.js run the hotkey through the SAME path as the
// header button — proctoring guardrail, then persist. Without it the hotkey was
// a second, weaker door: it could re-hide the overlay during a proctored exam,
// and its flip was forgotten on the next launch.
function registerStealthToggle(overlayWin, indicatorWin, accelerator, onToggle) {
  const ok = globalShortcut.register(accelerator, () => {
    const want = !appState.stealthEnabled;
    if (typeof onToggle === 'function') onToggle(want);
    else applyScreenShareHidden(overlayWin, indicatorWin, want, 'hotkey');
  });

  if (!ok) {
    console.error(`Failed to register global shortcut: ${accelerator} (already in use by another app?)`);
  }

  return ok;
}

function unregisterAll() {
  globalShortcut.unregisterAll();
}

module.exports = { registerStealthToggle, applyScreenShareHidden, unregisterAll };
