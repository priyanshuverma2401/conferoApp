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
  // Remembered so the collapse/expand toggle below can restore the exact lock —
  // it has to lift it to shrink the window down to the floating bar.
  win.__panelHeight = winHeight;
  win.__maxWidth = Math.max(1100, screenWidth);

  win.setAlwaysOnTop(true, 'screen-saver');
  // Stealth on by default. CONFERO_DEV_VISIBLE=1 disables content protection so
  // the overlay can be screenshotted during development/QA (never set in prod).
  win.setContentProtection(!process.env.CONFERO_DEV_VISIBLE);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '../../renderer/index.html'));

  return win;
}

// "Hide" on the floating bar: the panel goes away but the SESSION keeps running,
// so the window has to shrink to just the bar. Leaving it panel-sized with a
// transparent body would look right and behave wrong — a transparent window still
// eats every click over its area, so the meeting underneath would stop responding.
// Sized to the bar itself (measured 169×41 plus the body's 6px top / 8px bottom),
// with only enough slack for the drop shadow and for font metrics to differ on
// another machine. Every extra pixel here is transparent window that still
// swallows clicks meant for the meeting underneath.
const BAR = { width: 190, height: 64 };

function setOverlayCollapsed(win, collapsed) {
  if (!win || win.isDestroyed()) return null;
  const now = win.getBounds();
  if (collapsed) {
    if (!win.__expandedBounds) win.__expandedBounds = now;
    // Collapse around the window's CURRENT centre, not the screen's: if the user
    // dragged Confero somewhere, the bar should stay where they put it.
    const x = Math.round(now.x + (now.width - BAR.width) / 2);
    win.setMinimumSize(BAR.width, BAR.height);
    win.setMaximumSize(BAR.width, BAR.height);
    win.setBounds({ x, y: now.y, width: BAR.width, height: BAR.height });
  } else {
    const prev = win.__expandedBounds || {};
    const width = prev.width || 430;
    const height = win.__panelHeight || prev.height || 600;
    win.setMinimumSize(360, height);
    win.setMaximumSize(win.__maxWidth || 1100, height);
    // Re-expand around the bar's centre for the same reason — but CLAMPED to the
    // display it's on. The bar is small enough to park in a corner; growing back
    // to full size from there would push the panel (and its drag handle, and the
    // answer) off-screen with no way to get it back.
    const area = screen.getDisplayNearestPoint({ x: now.x + Math.round(now.width / 2), y: now.y }).workArea;
    const x = Math.min(Math.max(Math.round(now.x + (now.width - width) / 2), area.x), area.x + area.width - width);
    const y = Math.min(Math.max(now.y, area.y), area.y + Math.max(0, area.height - height));
    win.setBounds({ x, y, width, height });
    win.__expandedBounds = null;
  }
  return { collapsed: Boolean(collapsed) };
}

module.exports = { createOverlayWindow, setOverlayCollapsed };
