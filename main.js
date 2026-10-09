const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createPlatformInput } = require('./lib/platform-input');
const { MacroRunner } = require('./lib/macro');
const { parseOptions } = require('./lib/options');
const { directory, writeStatus } = require('./lib/state');
const pkg = require('./package.json');

const options = parseOptions(process.argv.slice(2));
app.setName('OpenWhip NightPlay');
app.setPath('userData', directory);
if (process.platform === 'win32') app.setAppUserModelId('NightPlay.OpenWhip');

let tray, overlay, input, runner, focusPoll;
let overlayReady = false;
let spawnQueued = false;
let lastTarget = null;
let lastMacroAt = 0;
let lastNoticeAt = 0;
let status = { running: false, pid: process.pid, version: pkg.version, package: pkg.name, appPath: __dirname };

function updateStatus(values) {
  status = { ...status, ...values };
  writeStatus(status);
}

function reportError(error) {
  const message = error?.message || String(error);
  console.warn(new Date().toISOString(), message);
  updateStatus({ lastResult: { sent: false, reason: message, at: new Date().toISOString() } });
  if (tray && process.platform === 'win32' && Date.now() - lastNoticeAt > 5000) {
    lastNoticeAt = Date.now();
    tray.displayBalloon({ title: 'OpenWhip', content: message, iconType: 'warning' });
  }
}

function fallbackTrayIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'icon', 'Template.png'));
  if (image.isEmpty()) throw new Error('Tray icon is missing or invalid.');
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

async function getTrayIcon() {
  const iconDir = path.join(__dirname, 'icon');
  if (process.platform === 'win32') {
    const image = nativeImage.createFromPath(path.join(iconDir, 'icon.ico'));
    if (!image.isEmpty()) return image;
  } else if (process.platform === 'darwin') {
    const file = path.join(iconDir, 'AppIcon.icns');
    if (fs.existsSync(file)) {
      try {
        const temporary = path.join(os.tmpdir(), 'openwhip-nightplay-tray.icns');
        fs.copyFileSync(file, temporary);
        const image = await nativeImage.createThumbnailFromPath(temporary, { width: 64, height: 64 });
        if (!image.isEmpty()) return image;
      } catch (error) { console.warn('Tray thumbnail:', error.message); }
    }
  }
  return fallbackTrayIcon();
}

function desktopBounds() {
  const displays = screen.getAllDisplays().map(display => display.bounds);
  const x = Math.min(...displays.map(bounds => bounds.x));
  const y = Math.min(...displays.map(bounds => bounds.y));
  return {
    x, y,
    width: Math.max(...displays.map(bounds => bounds.x + bounds.width)) - x,
    height: Math.max(...displays.map(bounds => bounds.y + bounds.height)) - y,
  };
}

function spawnWhip() {
  const cursor = screen.getCursorScreenPoint();
  const bounds = overlay.getBounds();
  overlay.webContents.send('spawn-whip', { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
}

function hideOverlay() {
  if (overlay) overlay.hide();
  updateStatus({ overlay: { visible: false, ready: overlayReady } });
  if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...desktopBounds(), show: false, transparent: true, frame: false,
    alwaysOnTop: true, focusable: false, skipTaskbar: true,
    resizable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlayReady = false;
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    updateStatus({ overlay: { ready: true, visible: overlay.isVisible(), bounds: overlay.getBounds() } });
    if (spawnQueued && overlay?.isVisible()) {
      spawnQueued = false;
      spawnWhip();
    }
  });
  overlay.webContents.on('will-navigate', event => event.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.on('closed', () => {
    overlay = null;
    overlayReady = false;
    spawnQueued = false;
    if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
  });
  overlay.loadFile(path.join(__dirname, 'overlay.html')).catch(reportError);
}

async function toggleOverlay(fromTray = false) {
  if (overlay?.isVisible()) {
    overlay.webContents.send('drop-whip');
    return;
  }
  // The tray can become foreground. Restore the actual last app, never guess with Alt+Tab.
  if (fromTray && process.platform === 'win32' && !input.captureTarget()) {
    if (!await input.restoreTarget(lastTarget)) throw new Error('Focus your app and press Ctrl+Alt+W to pick up the whip.');
  }
  if (!overlay) createOverlay();
  overlay.setBounds(desktopBounds());
  overlay.showInactive();
  updateStatus({ overlay: { visible: true, ready: overlayReady, bounds: overlay.getBounds() } });
  globalShortcut.register('Escape', () => overlay?.webContents.send('drop-whip'));
  if (overlayReady) spawnWhip();
  else spawnQueued = true;
}

async function runMacro() {
  if (runner.busy || Date.now() - lastMacroAt < 1000) return;
  const target = await input.captureTarget();
  if (runner.busy) return;
  lastMacroAt = Date.now();
  const result = await runner.run(target);
  if (result.sent) updateStatus({ lastResult: { sent: true, at: new Date().toISOString() } });
}

function invoke(operation) {
  Promise.resolve().then(operation).catch(reportError);
}

function registerShortcuts() {
  const shortcuts = {};
  for (const [key, action] of [
    ['Control+Alt+W', () => invoke(() => toggleOverlay())],
    ['Control+Alt+Enter', () => invoke(runMacro)],
  ]) {
    shortcuts[key] = globalShortcut.register(key, action);
    if (!shortcuts[key]) console.warn(`Shortcut ${key} is already in use by another app. Use the tray or change that app's shortcut.`);
  }
  return shortcuts;
}

if (!app.requestSingleInstanceLock({ command: options.command })) {
  app.quit();
} else if (options.command === 'quit') {
  app.quit();
} else {
  app.on('second-instance', (_event, _argv, _directory, data) => {
    if (data?.command === 'quit') app.quit();
  });
  ipcMain.on('whip-crack', event => {
    if (overlay?.isVisible() && event.sender === overlay.webContents) invoke(runMacro);
  });
  ipcMain.on('hide-overlay', event => {
    if (event.sender === overlay?.webContents) hideOverlay();
  });

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();
    input = createPlatformInput();
    runner = new MacroRunner(input, options);
    if (process.platform === 'win32') {
      lastTarget = input.captureTarget();
      focusPoll = setInterval(() => {
        const target = input.captureTarget();
        if (target) lastTarget = target;
      }, 80);
    }
    tray = new Tray(await getTrayIcon());
    tray.setToolTip('OpenWhip • Ctrl+Alt+W: whip • Ctrl+Alt+Enter: send');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Pick up / drop whip (Ctrl+Alt+W)', click: () => invoke(() => toggleOverlay(true)) },
      { label: 'Send Ctrl+C → message → Enter (Ctrl+Alt+Enter)', click: () => invoke(async () => {
        if (process.platform === 'win32' && !input.captureTarget()) {
          if (!await input.restoreTarget(lastTarget)) throw new Error('Focus your app and press Ctrl+Alt+Enter.');
        }
        await runMacro();
      }) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    tray.on('click', () => invoke(() => toggleOverlay(true)));
    const shortcuts = registerShortcuts();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => { if (overlay) overlay.setBounds(desktopBounds()); });
    }
    updateStatus({ running: true, startedAt: new Date().toISOString(), shortcuts });
    console.log(new Date().toISOString(), `OpenWhip ${pkg.version} ready (PID ${process.pid}).`);
  }).catch(error => {
    console.error('OpenWhip startup failed:', error);
    updateStatus({ running: false, error: error.message });
    app.exit(1);
  });

  app.on('window-all-closed', event => event.preventDefault());
  app.on('will-quit', () => {
    clearInterval(focusPoll);
    globalShortcut.unregisterAll();
    updateStatus({ running: false });
  });
}
