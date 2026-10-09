const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac' };
const MAX_BYTES = 20 * 1024 * 1024;

function validateSound(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || !/^[a-f0-9]{64}\.(mp3|wav|ogg|opus|flac|m4a|aac)$/.test(value.file)
    || typeof value.name !== 'string' || value.name.length > 255 || /[\x00-\x1f]/.test(value.name)) throw new Error('Invalid custom sound setting.');
  return { file: value.file, name: value.name };
}
async function readAudio(file) {
  const extension = path.extname(file).toLowerCase();
  if (!MIME[extension]) throw new Error('Choose an MP3, WAV, OGG, Opus, FLAC, M4A or AAC audio file.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) throw new Error('Sound files must be nonempty and no larger than 20 MB.');
  const data = await fs.readFile(file);
  if (data.length > MAX_BYTES) throw new Error('Sound files must be no larger than 20 MB.');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return { data, extension, hash, src: `data:${MIME[extension]};base64,${data.toString('base64')}` };
}
async function importSound(profile, file, validateAudio) {
  const audio = await readAudio(file);
  await validateAudio(audio.src);
  const directory = path.join(profile, 'sounds');
  await fs.mkdir(directory, { recursive: true });
  const name = `${audio.hash}${audio.extension}`;
  await fs.writeFile(path.join(directory, name), audio.data);
  return { setting: { file: name, name: path.basename(file) }, src: audio.src };
}
async function loadSound(profile, value) {
  const sound = validateSound(value);
  if (!sound) return null;
  const audio = await readAudio(path.join(profile, 'sounds', sound.file));
  if (`${audio.hash}${audio.extension}` !== sound.file) throw new Error('The saved custom sound is damaged. Choose it again.');
  return { src: audio.src, name: sound.name };
}

module.exports = { MIME, MAX_BYTES, validateSound, importSound, loadSound };
