const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importSound, loadSound, validateSound } = require('../lib/sound');
const { createSettingsStore } = require('../lib/settings');

test('custom audio survives moving the original and preserves message/update preferences', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openwhip-sound-test-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'effect.wav');
  fs.writeFileSync(file, Buffer.from('test audio content'));
  const imported = await importSound(profile, file, async src => assert.ok(src.startsWith('data:audio/wav;base64,')));
  const settings = createSettingsStore(profile);
  settings.saveMessage('Keep this message');
  settings.saveAutoUpdates(false);
  settings.saveSound(imported.setting);
  fs.unlinkSync(file);
  assert.equal((await loadSound(profile, settings.read().sound)).src, imported.src);
  assert.equal(settings.read().message, 'Keep this message');
  assert.equal(settings.read().autoUpdates, false);
  settings.saveSound(null);
  assert.equal(settings.read().sound, null);
  assert.equal(settings.read().message, 'Keep this message');
});

test('unsupported files, decoder failures, path traversal and damaged copies are rejected', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openwhip-sound-test-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const file = path.join(profile, 'effect.wav');
  fs.writeFileSync(file, 'audio');
  await assert.rejects(importSound(profile, file, async () => { throw new Error('Decoder rejected'); }), /Decoder rejected/);
  assert.equal(fs.existsSync(path.join(profile, 'sounds')), false);
  fs.writeFileSync(path.join(profile, 'effect.js'), 'not audio');
  await assert.rejects(importSound(profile, path.join(profile, 'effect.js'), async () => {}), /audio file/);
  assert.throws(() => validateSound({ file: '../other.wav', name: 'effect' }));
  const imported = await importSound(profile, file, async () => {});
  fs.writeFileSync(path.join(profile, 'sounds', imported.setting.file), 'modified');
  await assert.rejects(loadSound(profile, imported.setting), /damaged/);
});
