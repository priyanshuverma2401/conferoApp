const path = require('path');
const { BrowserWindow, screen } = require('electron');

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  // workArea (not workAreaSize) so x/y are the display's own origin — on a second
  // monitor or with the taskbar on top/left, a bare 0,0 lands in the wrong place.
  const { x: areaX, y: areaY, width: screenWidth, height: screenHeight } = display.workArea;

  // Height is FIXED and tall — a live interview gives no time to resize, and the
  // answer/controls must always fit without clipping. Width alone stretches, so
  // the user can widen for long answers. (Locked via min/max size below.)
  const winHeight = Math.min(720, screenHeight - 60);
  const winWidth = 430;

  // Opens TOP-CENTRE — directly under the laptop camera. Reading an answer then
  // costs the smallest possible eye movement away from the lens, so the candidate
  // still looks roughly like they're holding eye contact; parked in a corner, the
  // glance sideways is obvious to the interviewer. Only the STARTING position is
  // fixed — the window is still freely draggable by its header.
  const startX = areaX + Math.round((screenWidth - winWidth) / 2);
  const startY = areaY + 12;

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: startX,
    y: startY,
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
