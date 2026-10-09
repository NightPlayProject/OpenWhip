const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createPlatformInput } = require('./lib/platform-input');
const { MacroRunner } = require('./lib/macro');
const { createSettingsStore } = require('./lib/settings');
const { importSound, loadSound } = require('./lib/sound');
const { Updater } = require('./lib/updater');
const { isManagedInstall, writeJSON } = require('./lib/runtime');
const { parseOptions } = require('./lib/options');
const { directory, writeStatus } = require('./lib/state');
const pkg = require('./package.json');

const options = parseOptions(process.argv.slice(2));
app.setName('OpenWhip NightPlay');
fs.mkdirSync(directory, { recursive: true });
app.setPath('userData', directory);
if (process.platform === 'win32') app.setAppUserModelId('NightPlay.OpenWhip');

let tray, trayMenu, overlay, messageEditor, input, runner, focusPoll, cursorPoll, appReady;
let quitting = false;
let updater, updateCheckTimer, updateApplyTimer, updateStartTimer;
let startingUpdate = false;
let manualUpdateRequested = false;
let soundDialogOpen = false;
let soundConfig = null;
let whipDropping = false;
const settings = createSettingsStore(directory);
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
  if (error?.code !== 'WHIP_CANCELLED' && tray && process.platform === 'win32' && Date.now() - lastNoticeAt > 5000) {
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

function displayBounds() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
}

function spawnWhip() {
  const cursor = screen.getCursorScreenPoint();
  const bounds = overlay.getBounds();
  overlay.webContents.send('spawn-whip', { x: cursor.x - bounds.x, y: cursor.y - bounds.y, time: performance.timeOrigin + performance.now() });
}

function hideOverlay() {
  clearInterval(cursorPoll);
  cursorPoll = null;
  runner?.cancel();
  if (overlay) {
    overlay.webContents.send('stop-whip');
    overlay.hide();
  }
  whipDropping = false;
  spawnQueued = false;
  updateStatus({ overlay: { visible: false, ready: overlayReady } });
  if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
}

function dropWhip() {
  if (!overlay?.isVisible() || whipDropping) return;
  whipDropping = true;
  runner.cancel();
  clearInterval(cursorPoll);
  cursorPoll = null;
  overlay.webContents.send('drop-whip');
}

function trackCursor() {
  clearInterval(cursorPoll);
  let mouseArmed = !input.mouseButtonsDown?.();
  cursorPoll = setInterval(() => {
    if (!overlay?.isVisible() || !overlayReady || whipDropping) return;
    const pressed = input.mouseButtonsDown?.() || false;
    if (!pressed) mouseArmed = true;
    if (pressed && mouseArmed) { dropWhip(); return; }
    const cursor = screen.getCursorScreenPoint();
    const bounds = overlay.getBounds();
    const next = screen.getDisplayNearestPoint(cursor).bounds;
    if (bounds.x !== next.x || bounds.y !== next.y || bounds.width !== next.width || bounds.height !== next.height) {
      overlay.setBounds(next);
      overlay.webContents.send('rebase-whip', { x: bounds.x - next.x, y: bounds.y - next.y });
      updateStatus({ overlay: { visible: true, ready: true, clickThrough: true, bounds: next } });
    }
    overlay.webContents.send('cursor-state', { x: cursor.x - next.x, y: cursor.y - next.y, time: performance.timeOrigin + performance.now() });
  }, 8);
}

function createOverlay() {
  overlay = new BrowserWindow({
    ...displayBounds(), show: false, transparent: true, frame: false,
    alwaysOnTop: true, focusable: false, skipTaskbar: true,
    resizable: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: true,
    },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setIgnoreMouseEvents(true);
  overlayReady = false;
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    overlay.webContents.send('sound-config', soundConfig);
    updateStatus({ overlay: { ready: true, visible: overlay.isVisible(), clickThrough: true, bounds: overlay.getBounds() } });
    if (spawnQueued && overlay?.isVisible()) {
      spawnQueued = false;
      spawnWhip();
    }
  });
  overlay.webContents.on('will-navigate', event => event.preventDefault());
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.on('closed', () => {
    overlay = null;
    clearInterval(cursorPoll);
    cursorPoll = null;
    overlayReady = false;
    spawnQueued = false;
    if (globalShortcut.isRegistered('Escape')) globalShortcut.unregister('Escape');
  });
  overlay.loadFile(path.join(__dirname, 'overlay.html')).catch(reportError);
}

async function toggleOverlay(fromTray = false) {
  if (overlay?.isVisible()) {
    dropWhip();
    return;
  }
  // The tray can become foreground. Restore the actual last app, never guess with Alt+Tab.
  if (fromTray && process.platform === 'win32' && !input.captureTarget()) {
    if (!await input.restoreTarget(lastTarget)) throw new Error('Focus your app and press Ctrl+Alt+W to pick up the whip.');
  }
  if (!overlay) createOverlay();
  whipDropping = false;
  overlay.setBounds(displayBounds());
  overlay.showInactive();
  updateStatus({ overlay: { visible: true, ready: overlayReady, clickThrough: true, bounds: overlay.getBounds() } });
  globalShortcut.register('Escape', dropWhip);
  trackCursor();
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
  ]) {
    shortcuts[key] = globalShortcut.register(key, action);
    if (!shortcuts[key]) console.warn(`Shortcut ${key} is already in use by another app. Use the tray or change that app's shortcut.`);
  }
  return shortcuts;
}

function updateTrayMenu() {
  const updateLabels = { idle: 'Updates checked automatically', development: 'Updates disabled for this copy', checking: 'Checking for updates…', downloading: 'Downloading update…', ready: 'Update ready — put away the whip to restart', current: 'You are up to date', error: 'Update failed — try checking again', restarting: 'Restarting for update…' };
  trayMenu = Menu.buildFromTemplate([
    { label: 'Pick up / drop whip (Ctrl+Alt+W)', click: () => invoke(() => toggleOverlay(true)) },
    { type: 'separator' },
    { label: 'Custom message…', click: showMessageEditor },
    { label: 'Use random messages', type: 'checkbox', checked: !runner.options.message, click: () => invoke(() => applyMessage('')) },
    { label: 'Whip sound', submenu: [
      { label: 'Choose custom sound…', enabled: !soundDialogOpen, click: () => invoke(chooseSound) },
      { label: 'Preview sound', click: () => invoke(previewSound) },
      { label: 'Use default sounds', type: 'checkbox', checked: !soundConfig, click: () => invoke(resetSound) },
    ] },
    { type: 'separator' },
    { label: 'Updates', submenu: [
      { label: updateLabels[updater?.status.phase || 'idle'], enabled: false },
      { label: 'Automatic updates', type: 'checkbox', checked: updater?.enabled !== false, enabled: Boolean(updater?.supported), click: item => {
        settings.saveAutoUpdates(item.checked);
        updater.setEnabled(item.checked);
        if (item.checked) { invoke(() => updater.check()); tryApplyUpdate(); }
      } },
      { label: 'Check for updates', enabled: Boolean(updater?.supported && !updater.busy && !startingUpdate), click: () => invoke(() => updater.check(true)) },
      ...(updater?.pending ? [{ label: 'Install update and restart', click: () => tryApplyUpdate(true) }] : []),
    ] },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
}

async function ensureOverlayReady() {
  if (!overlay) createOverlay();
  if (overlayReady) return;
  await new Promise((resolve, reject) => {
    const contents = overlay.webContents;
    const done = () => { contents.removeListener('did-fail-load', failed); resolve(); };
    const failed = () => { contents.removeListener('did-finish-load', done); reject(new Error('Could not load sound playback.')); };
    contents.once('did-finish-load', done);
    contents.once('did-fail-load', failed);
  });
}

async function validateAudioSource(src) {
  await ensureOverlayReady();
  await overlay.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const audio = new Audio();
    const timeout = setTimeout(() => reject(new Error('Audio file could not be decoded.')), 5000);
    audio.onloadedmetadata = () => { clearTimeout(timeout); if (audio.duration > 0 && Number.isFinite(audio.duration)) resolve(); else reject(new Error('Audio file has no playable duration.')); };
    audio.onerror = () => { clearTimeout(timeout); reject(new Error('This audio file cannot be played. Choose another sound.')); };
    audio.src = ${JSON.stringify(src)};
  })`);
}

async function chooseSound() {
  if (soundDialogOpen) return;
  hideOverlay();
  soundDialogOpen = true;
  updateTrayMenu();
  try {
    const result = await dialog.showOpenDialog({ title: 'Choose your whip sound', properties: ['openFile'], filters: [{ name: 'Audio files', extensions: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'm4a', 'aac'] }] });
    if (result.canceled || !result.filePaths.length) return;
    const imported = await importSound(directory, result.filePaths[0], validateAudioSource);
    settings.saveSound(imported.setting);
    soundConfig = { src: imported.src, name: imported.setting.name };
    overlay.webContents.send('sound-config', soundConfig);
    updateStatus({ soundMode: 'custom' });
  } finally {
    soundDialogOpen = false;
    updateTrayMenu();
    if (!quitting && process.platform === 'win32' && lastTarget) await input.restoreTarget(lastTarget);
  }
}

async function previewSound() {
  await ensureOverlayReady();
  overlay.webContents.send('sound-preview');
}

function resetSound() {
  settings.saveSound(null);
  soundConfig = null;
  if (overlayReady) overlay.webContents.send('sound-config', null);
  updateStatus({ soundMode: 'default' });
  updateTrayMenu();
}

function tryApplyUpdate(manual = false) {
  if (manual) manualUpdateRequested = true;
  if (startingUpdate || !updater?.pending || (!updater.enabled && !manualUpdateRequested) || runner.busy || overlay?.isVisible() || messageEditor || soundDialogOpen || quitting) return;
  const pending = updater.pending;
  const updateDirectory = path.join(directory, 'updates');
  fs.mkdirSync(updateDirectory, { recursive: true });
  const helper = path.join(updateDirectory, 'update-helper.js');
  const plan = path.join(updateDirectory, 'handoff-plan.json');
  fs.copyFileSync(path.join(__dirname, 'bin', 'update-helper.js'), helper);
  const args = ['--interrupt-delay', String(options.interruptDelay), '--enter-delay', String(options.enterDelay)];
  if (options.message) args.push('--message', options.message);
  writeJSON(plan, { profile: directory, parentPid: process.pid, node: pending.node, installRoot: process.env.OPENWHIP_INSTALL_ROOT || __dirname, fallbackPath: __dirname, release: pending, args });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(pending.node, [helper, plan], { detached: true, stdio: 'ignore', windowsHide: true, env });
  startingUpdate = true;
  child.once('error', error => { startingUpdate = false; updater.publish({ phase: 'error', error: error.message }); });
  child.once('spawn', () => { child.unref(); updater.publish({ phase: 'restarting' }); app.quit(); });
}

function applyMessage(value) {
  const message = settings.saveMessage(value);
  runner.options.message = message;
  updateTrayMenu();
  updateStatus({ messageMode: message ? 'custom' : 'random' });
}

function showMessageEditor() {
  hideOverlay();
  if (messageEditor) { messageEditor.show(); messageEditor.focus(); return; }
  messageEditor = new BrowserWindow({
    width: 560, height: 370, useContentSize: true, show: false,
    title: 'Whip message', resizable: false, minimizable: false,
    backgroundColor: '#181a20', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'message-preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  messageEditor.setMenu(null);
  messageEditor.webContents.on('will-navigate', event => event.preventDefault());
  messageEditor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  messageEditor.once('ready-to-show', () => { messageEditor?.show(); messageEditor?.focus(); });
  messageEditor.on('closed', () => {
    messageEditor = null;
    if (!quitting && process.platform === 'win32' && lastTarget) input.restoreTarget(lastTarget).catch(reportError);
  });
  messageEditor.loadFile(path.join(__dirname, 'message.html')).catch(reportError);
}

if (!app.requestSingleInstanceLock({ command: options.command })) {
  app.quit();
} else if (options.command === 'quit') {
  app.quit();
} else {
  app.on('second-instance', (_event, _argv, _directory, data) => {
    if (data?.command === 'quit') app.quit();
    if (data?.command === 'check-updates') invoke(() => updater.check(true));
  });
  ipcMain.on('sound-played', (event, mode) => {
    if (event.sender === overlay?.webContents && ['custom', 'default'].includes(mode)) updateStatus({ lastSound: { mode, at: new Date().toISOString() } });
  });
  ipcMain.on('whip-crack', event => {
    if (overlay?.isVisible() && !whipDropping && event.sender === overlay.webContents) invoke(runMacro);
  });
  ipcMain.on('hide-overlay', event => {
    if (event.sender === overlay?.webContents) hideOverlay();
  });
  ipcMain.handle('message-load', event => {
    if (event.sender !== messageEditor?.webContents) throw new Error('Unknown message editor.');
    return runner.options.message || '';
  });
  ipcMain.handle('message-save', (event, value) => {
    if (event.sender !== messageEditor?.webContents) throw new Error('Unknown message editor.');
    try {
      applyMessage(value);
      const editor = messageEditor;
      setTimeout(() => { if (!editor.isDestroyed()) editor.close(); }, 50);
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.on('message-close', event => {
    if (event.sender === messageEditor?.webContents) messageEditor.close();
  });

  appReady = app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock.hide();
    input = createPlatformInput();
    let saved = { message: '', sound: null, autoUpdates: true };
    try { saved = settings.read(); }
    catch (error) { console.warn('Could not load saved message:', error.message); }
    runner = new MacroRunner(input, { ...options, message: options.message ?? saved.message });
    try { soundConfig = await loadSound(directory, saved.sound); }
    catch (error) { console.warn('Could not load custom sound:', error.message); }
    updater = new Updater({ profile: directory, version: pkg.version, supported: isManagedInstall(__dirname), enabled: saved.autoUpdates,
      onStatus: update => { updateStatus({ update }); if (tray) updateTrayMenu(); }, onReady: () => tryApplyUpdate(),
    });
    if (process.platform === 'win32') {
      lastTarget = input.captureTarget();
      focusPoll = setInterval(() => {
        const target = input.captureTarget();
        if (target) lastTarget = target;
      }, 80);
    }
    tray = new Tray(await getTrayIcon());
    tray.setToolTip('OpenWhip • Crack the whip to send • Right-click to set a message');
    updateTrayMenu();
    tray.on('click', () => invoke(() => toggleOverlay(true)));
    const shortcuts = registerShortcuts();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => { if (overlay?.isVisible()) { overlay.setBounds(displayBounds()); if (overlayReady) spawnWhip(); } });
    }
    updateStatus({ running: true, startedAt: new Date().toISOString(), shortcuts, messageMode: runner.options.message ? 'custom' : 'random', soundMode: soundConfig ? 'custom' : 'default', update: updater.status });
    if (process.env.OPENWHIP_DISABLE_UPDATE_CHECKS !== '1') {
      updateStartTimer = setTimeout(() => invoke(() => updater.check(options.command === 'check-updates')), 15000);
      updateCheckTimer = setInterval(() => invoke(() => updater.check()), 60 * 60 * 1000);
      updateApplyTimer = setInterval(tryApplyUpdate, 1000);
    }
    console.log(new Date().toISOString(), `OpenWhip ${pkg.version} ready (PID ${process.pid}).`);
  }).catch(error => {
    console.error('OpenWhip startup failed:', error);
    updateStatus({ running: false, error: error.message });
    app.exit(1);
  });

  app.on('window-all-closed', event => event.preventDefault());
  app.on('will-quit', () => {
    quitting = true;
    clearInterval(focusPoll);
    clearInterval(cursorPoll);
    clearTimeout(updateStartTimer);
    clearInterval(updateCheckTimer);
    clearInterval(updateApplyTimer);
    runner?.cancel();
    globalShortcut.unregisterAll();
    updateStatus({ running: false });
  });
}

module.exports = { ready: () => appReady, getTrayMenu: () => trayMenu, getMessageEditor: () => messageEditor, getOverlay: () => overlay, getUpdater: () => updater };
