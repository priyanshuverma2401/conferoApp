const path = require('path');
const { BrowserWindow, screen } = require('electron');

function createIndicatorWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.workAreaSize;

  const win = new BrowserWindow({
    width: 150,
    height: 40,
    x: screenWidth - 170,
    y: 8,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // Always protected, independent of the main overlay's stealth toggle — this dot
  // must never appear in a capture even if stealth is turned "off" for the transcript.
  win.setContentProtection(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '../../renderer/indicatorWindow.html'));

  return win;
}

module.exports = { createIndicatorWindow };
