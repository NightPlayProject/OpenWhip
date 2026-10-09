const fs = require('node:fs');
const path = require('node:path');
const { validateMessage } = require('./options');
const { validateSound } = require('./sound');

function createSettingsStore(directory) {
  const file = path.join(directory, 'settings.json');
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings file.');
      return { ...value, message: validateMessage(value.message ?? '', true), sound: validateSound(value.sound), autoUpdates: value.autoUpdates !== false };
    } catch (error) {
      if (error.code === 'ENOENT') return { message: '', sound: null, autoUpdates: true };
      throw error;
    }
  }
  function save(values) {
    const settings = { ...read(), ...values };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(temporary, file);
    return settings;
  }
  const saveMessage = value => save({ message: validateMessage(value, true) }).message;
  const saveSound = value => save({ sound: validateSound(value) }).sound;
  const saveAutoUpdates = value => {
    if (typeof value !== 'boolean') throw new Error('Invalid update preference.');
    return save({ autoUpdates: value }).autoUpdates;
  };
  return { file, read, saveMessage, saveSound, saveAutoUpdates };
}

module.exports = { createSettingsStore };
