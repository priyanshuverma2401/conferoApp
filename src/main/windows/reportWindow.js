const path = require('path');
const { BrowserWindow, screen } = require('electron');

// The end-of-session report lives in its own full-size window, not in the
// overlay: it's a DOCUMENT — minutes you read, copy, and interrogate afterwards
// — and the overlay is a 380px-wide stealth strip built for glancing at during a
// call. This window is deliberately ordinary: normal chrome, white page, resizable,
// in the taskbar. It is NOT content-protected — the call is over by the time it
// opens, and the whole point is being able to share or screenshot the recap.
let win = null;

function createReportWindow({ productName = 'Confero', onClosed } = {}) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return win;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1180, Math.max(880, width - 160)),
    height: Math.min(880, Math.max(620, height - 120)),
    minWidth: 620,
    minHeight: 480,
    show: false,
    // Painted before the renderer loads, so opening never flashes black behind
    // a white page.
    backgroundColor: '#ffffff',
    title: `${productName} — Session report`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '../../renderer/report.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    win = null;
    if (onClosed) onClosed();
  });
  return win;
}

function getReportWindow() {
  return win && !win.isDestroyed() ? win : null;
}

function closeReportWindow() {
  if (win && !win.isDestroyed()) {
    try { win.close(); } catch (_) { /* already going away */ }
  }
  win = null;
}

module.exports = { createReportWindow, getReportWindow, closeReportWindow };
