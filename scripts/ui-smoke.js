const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { directory, readStatus } = require('../lib/state');
const { createSettingsStore } = require('../lib/settings');

const phase = process.env.OPENWHIP_UI_SMOKE_PHASE;
const store = createSettingsStore(directory);
if (phase === 'edit') { store.saveMessage(''); store.saveSound(null); store.saveAutoUpdates(true); }
const core = require(process.env.OPENWHIP_UI_SMOKE_APP || '../main');
const message = 'Keep working until complete café 🐸';
const output = path.resolve(__dirname, '..', 'out', 'validation');
const soundFile = path.join(output, 'fixture-effect.wav');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [soundFile] });

async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(label);
}

async function openEditor() {
  const item = core.getTrayMenu().items.find(item => item.label === 'Custom message…');
  assert.ok(item, 'Tray custom-message menu item is missing.');
  item.click();
  const window = core.getMessageEditor();
  assert.ok(window);
  await until(() => !window.webContents.isLoading(), 'Editor did not load.');
  await until(async () => await window.webContents.executeJavaScript('Boolean(window.messageEditor && document.getElementById("message"))'), 'Preload or message field missing.');
  return window;
}

async function main() {
  await core.ready();
  assert.equal(readStatus().shortcuts['Control+Alt+Enter'], undefined);
  assert.equal(core.getTrayMenu().items.some(item => /Send Ctrl/.test(item.label)), false);
  let window = await openEditor();
  if (phase === 'restart') {
    await until(async () => await window.webContents.executeJavaScript('document.getElementById("message").value') === message, 'Saved message did not load after relaunch.');
    assert.equal(readStatus().messageMode, 'custom');
    assert.equal(readStatus().soundMode, 'custom');
    assert.equal(readStatus().update.enabled, false);
    window.close();
    console.log('UI restart: saved custom text restored.');
    app.quit();
    return;
  }
  const invalid = await window.webContents.executeJavaScript('window.messageEditor.save("line\\nunsafe")');
  assert.equal(invalid.ok, false);
  assert.equal(store.read().message, '');
  await window.webContents.executeJavaScript(`document.getElementById('message').value = ${JSON.stringify(message)}; document.getElementById('message').dispatchEvent(new Event('input'));`);
  await delay(100);
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(output, 'message-editor.png'), screenshot.toPNG());
  await window.webContents.executeJavaScript('document.getElementById("form").requestSubmit()');
  await until(() => core.getMessageEditor() === null, 'Save did not close the message editor.');
  assert.equal(store.read().message, message);
  assert.equal(readStatus().messageMode, 'custom');
  window = await openEditor();
  await window.webContents.executeJavaScript('document.getElementById("message").value = "Do not save this"; document.getElementById("cancel").click()');
  await until(() => core.getMessageEditor() === null, 'Cancel did not close the editor.');
  assert.equal(store.read().message, message);
  core.getTrayMenu().items.find(item => item.label === 'Use random messages').click();
  await until(() => store.read().message === '', 'Random-message tray option did not reset the setting.');
  window = await openEditor();
  await window.webContents.executeJavaScript(`document.getElementById('message').value = ${JSON.stringify(message)}; document.getElementById('form').requestSubmit();`);
  await until(() => core.getMessageEditor() === null, 'Saved message did not close.');
  fs.writeFileSync(soundFile, require('./audio-fixture').audioFixture());
  const soundMenu = () => core.getTrayMenu().items.find(item => item.label === 'Whip sound').submenu;
  soundMenu().items.find(item => item.label === 'Choose custom sound…').click();
  await until(() => readStatus().soundMode === 'custom', 'Custom sound did not pass the real audio decoder.');
  const soundSetting = store.read().sound;
  assert.ok(soundSetting.file.endsWith('.wav'));
  fs.unlinkSync(soundFile);
  soundMenu().items.find(item => item.label === 'Preview sound').click();
  await until(() => readStatus().lastSound?.mode === 'custom', 'Custom audio did not play after the source file was removed.');
  assert.equal(store.read().message, message);
  fs.writeFileSync(soundFile, 'This is not an audio file');
  soundMenu().items.find(item => item.label === 'Choose custom sound…').click();
  await until(() => Boolean(readStatus().lastResult?.reason), 'Invalid audio was not rejected by the real decoder.');
  assert.deepEqual(store.read().sound, soundSetting);
  assert.equal(store.read().message, message);
  fs.unlinkSync(soundFile);
  soundMenu().items.find(item => item.label === 'Use default sounds').click();
  await until(() => readStatus().soundMode === 'default', 'Default-sound tray option did not restore defaults.');
  fs.writeFileSync(soundFile, require('./audio-fixture').audioFixture());
  soundMenu().items.find(item => item.label === 'Choose custom sound…').click();
  await until(() => readStatus().soundMode === 'custom', 'Custom sound did not restore.');
  fs.unlinkSync(soundFile);
  const updates = core.getTrayMenu().items.find(item => item.label === 'Updates').submenu;
  const automatic = updates.items.find(item => item.label === 'Automatic updates');
  automatic.click({ checked: false });
  assert.equal(store.read().autoUpdates, false);
  fs.writeFileSync(path.join(output, process.env.OPENWHIP_UI_SMOKE_APP ? 'ui-smoke-installed.json' : 'ui-smoke-source.json'), JSON.stringify({ passed: true, installedPackage: Boolean(process.env.OPENWHIP_UI_SMOKE_APP), version: require('../package.json').version, results: ['Tray menu opens the real message editor.', 'Save persists exact Unicode text.', 'Invalid text is rejected without changing the setting.', 'Cancel preserves the existing message.', 'Tray random-message option restores defaults.'] }, null, 2) + '\n');
  console.log('UI editor and tray: messages, real custom-audio decode/playback, default sounds, and update preference passed.');
  app.quit();
}

main().catch(error => { console.error(error); app.exit(1); });
