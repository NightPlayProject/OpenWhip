const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore } = require('../lib/settings');

test('tray message persists, preserves other settings, and can return to random', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openwhip-settings-'));
  try {
    const store = createSettingsStore(directory);
    assert.equal(store.read().message, '');
    fs.writeFileSync(store.file, JSON.stringify({ message: '', otherSetting: 42 }));
    store.saveMessage('Keep working café 🐸');
    assert.equal(createSettingsStore(directory).read().message, 'Keep working café 🐸');
    assert.equal(store.read().otherSetting, 42);
    store.saveMessage('');
    assert.equal(store.read().message, '');
    assert.equal(store.read().otherSetting, 42);
  } finally {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  }
});

test('invalid messages cannot overwrite the saved setting', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openwhip-settings-'));
  try {
    const store = createSettingsStore(directory);
    store.saveMessage('Original');
    for (const message of ['a\nb', '\x1b', 'x'.repeat(501), null]) assert.throws(() => store.saveMessage(message));
    assert.equal(store.read().message, 'Original');
  } finally {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.rmdirSync(directory);
  }
});
