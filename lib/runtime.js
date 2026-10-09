const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = '@nightplayproject/openwhip';
function versionParts(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid release version.');
  return parts;
}
function compareVersions(a, b) {
  const first = versionParts(a), second = versionParts(b);
  for (let i = 0; i < 3; i++) if (first[i] !== second[i]) return Math.sign(first[i] - second[i]);
  return 0;
}
function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function validateRuntime(directory, release) {
  const appPath = path.join(directory, 'node_modules', '@nightplayproject', 'openwhip');
  const pkg = readJSON(path.join(appPath, 'package.json'));
  if (pkg?.name !== PACKAGE || pkg.version !== release.version) throw new Error('Downloaded package identity does not match the release.');
  for (const file of ['main.js', 'preload.js', 'overlay.html', 'bin/openwhip.js']) {
    if (!fs.statSync(path.join(appPath, file)).isFile()) throw new Error('Downloaded update is incomplete.');
  }
  return appPath;
}
function resolveRuntime(profile, installedPath, installedVersion) {
  try {
    const root = path.join(profile, 'updates');
    const active = readJSON(path.join(root, 'active.json'));
    if (!active || compareVersions(active.version, installedVersion) <= 0 || !/^[a-f0-9]{40}$/.test(active.sha)) return installedPath;
    if (!/^runtimes\/[\d.]+-[a-f0-9]{12}$/.test(active.directory)) return installedPath;
    const directory = path.join(root, active.directory);
    if (!isInside(fs.realpathSync(root), fs.realpathSync(directory))) return installedPath;
    const manifest = readJSON(path.join(directory, 'installed.json'));
    if (manifest?.version !== active.version || manifest?.sha !== active.sha) return installedPath;
    return validateRuntime(directory, active);
  } catch { return installedPath; }
}
function isManagedInstall(appPath) {
  return path.basename(appPath).toLowerCase() === 'openwhip'
    && path.basename(path.dirname(appPath)).toLowerCase() === '@nightplayproject'
    && path.basename(path.dirname(path.dirname(appPath))).toLowerCase() === 'node_modules';
}

module.exports = { PACKAGE, compareVersions, versionParts, readJSON, writeJSON, isInside, validateRuntime, resolveRuntime, isManagedInstall };
