const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = process.platform === 'win32'
  ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const directory = path.join(base, 'openwhip-nightplay');
const statusPath = path.join(directory, 'status.json');
const logPath = path.join(directory, 'openwhip.log');

function readStatus() {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (!status.running || !Number.isInteger(status.pid) || status.pid < 1) return { running: false };
    process.kill(status.pid, 0);
    return status;
  } catch {
    return { running: false };
  }
}

function writeStatus(status) {
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${statusPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(status, null, 2) + '\n');
  fs.renameSync(temporary, statusPath);
}

module.exports = { directory, statusPath, logPath, readStatus, writeStatus };
