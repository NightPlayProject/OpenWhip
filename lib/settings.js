const fs = require('node:fs');
const path = require('node:path');
const { validateMessage } = require('./options');

function createSettingsStore(directory) {
  const file = path.join(directory, 'settings.json');
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings file.');
      return { ...value, message: validateMessage(value.message ?? '', true) };
    } catch (error) {
      if (error.code === 'ENOENT') return { message: '' };
      throw error;
    }
  }
  function saveMessage(value) {
    const message = validateMessage(value, true);
    const settings = { ...read(), message };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(temporary, file);
    return message;
  }
  return { file, read, saveMessage };
}

module.exports = { createSettingsStore };
