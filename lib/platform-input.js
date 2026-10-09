const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const exec = promisify(execFile);

function createPlatformInput() {
  if (process.platform === 'win32') return require('./windows-input').createWindowsInput();
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Unsupported operating system.');

  const mac = process.platform === 'darwin';
  const apple = script => exec('osascript', ['-e', script], { timeout: 5000 });
  const xdo = args => exec('xdotool', args, { timeout: 5000 });
  async function captureTarget() {
    const { stdout } = mac
      ? await apple('tell application "System Events" to get unix id of first application process whose frontmost is true')
      : await xdo(['getactivewindow']);
    const id = stdout.trim();
    return /^\d+$/.test(id) && id !== '0' && (!mac || Number(id) !== process.pid) ? { id } : null;
  }
  async function isActive(target) {
    return Boolean(target && (await captureTarget())?.id === target.id);
  }
  async function guarded(target, operation) {
    if (!await isActive(target)) throw new Error('Active app changed; remaining keys cancelled.');
    return operation();
  }
  return {
    captureTarget, isActive,
    async waitForRelease(target) {
      await delay(250);
      await guarded(target, async () => {});
    },
    async restoreTarget() { return false; },
    interrupt: target => guarded(target, () => mac
      ? apple('tell application "System Events" to key code 8 using {control down}')
      : xdo(['key', '--clearmodifiers', 'ctrl+c'])),
    async type(target, text, assertContinuing = () => {}) {
      for (const character of text) {
        assertContinuing();
        const escaped = character.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await guarded(target, () => mac
          ? apple(`tell application "System Events" to keystroke "${escaped}"`)
          : xdo(['type', '--clearmodifiers', '--', character]));
      }
    },
    enter: target => guarded(target, () => mac
      ? apple('tell application "System Events" to key code 36')
      : xdo(['key', '--clearmodifiers', 'Return'])),
  };
}

module.exports = { createPlatformInput };
