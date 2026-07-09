const path = require('path');
const { BrowserWindow } = require('electron');

// The first-run setup window. Unlike the overlay, this is a normal, centered,
// non-stealth window — it's meant to be seen and interacted with, not hidden.
function createOnboardingWindow() {
  const win = new BrowserWindow({
    width: 860,
    height: 600,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    center: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '../../renderer/onboarding.html'));
  return win;
}

module.exports = { createOnboardingWindow };
