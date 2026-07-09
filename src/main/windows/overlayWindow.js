const path = require('path');
const { BrowserWindow, screen } = require('electron');

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;

  // Height is FIXED and tall — a live interview gives no time to resize, and the
  // answer/controls must always fit without clipping. Width alone stretches, so
  // the user can widen for long answers. (Locked via min/max size below.)
  const winHeight = Math.min(720, screenHeight - 60);
  const winWidth = 430;

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: screenWidth - winWidth - 20,
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Lock the height (min == max) so only the width is draggable.
  win.setMinimumSize(360, winHeight);
  win.setMaximumSize(Math.max(1100, screenWidth), winHeight);

  win.setAlwaysOnTop(true, 'screen-saver');
  // Stealth on by default. CONFERO_DEV_VISIBLE=1 disables content protection so
  // the overlay can be screenshotted during development/QA (never set in prod).
  win.setContentProtection(!process.env.CONFERO_DEV_VISIBLE);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '../../renderer/index.html'));

  return win;
}

module.exports = { createOverlayWindow };
