const path = require('path');
const { BrowserWindow, screen } = require('electron');

// A full-screen, transparent, content-protected overlay the candidate drags a
// rectangle on to snip a region of the screen (a DSA/LLD problem the interviewer
// shared as an image or on a screen-share the candidate can't select text from).
// Content protection is the whole point: like the main overlay, the interviewer's
// screen-share never sees this — not the dim, not the selection box. It also keeps
// the overlay OUT of the app's own desktopCapturer grab, so the crop is clean.
function createSnipWindow() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // Stealth by default; CONFERO_DEV_VISIBLE=1 disables it so the selection UI can
  // be screenshotted during development/QA (never set in prod).
  win.setContentProtection(!process.env.CONFERO_DEV_VISIBLE);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '../../renderer/snipOverlay.html'));
  win.on('ready-to-show', () => win.focus());
  return win;
}

module.exports = { createSnipWindow };
