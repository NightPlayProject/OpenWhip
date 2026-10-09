const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const crypto = require('node:crypto');
const { createSettingsStore } = require('../lib/settings');
const { importSound } = require('../lib/sound');
const { readJSON } = require('../lib/runtime');
const exec = promisify(execFile);

async function main() {
  const expected = process.argv[2];
  assert.ok(/^\d+\.\d+\.\d+$/.test(expected), 'Provide the newer GitHub release version to test.');
  const output = path.resolve(__dirname, '..', 'out', 'validation');
  fs.mkdirSync(output, { recursive: true });
  const appData = fs.mkdtempSync(path.join(output, 'live-update-'));
  const profile = path.join(appData, 'openwhip-nightplay');
  const cli = path.join(process.env.APPDATA, 'npm', 'node_modules', '@nightplayproject', 'openwhip', 'bin', 'openwhip.js');
  const bootstrap = JSON.parse(fs.readFileSync(path.join(path.dirname(cli), '..', 'package.json'), 'utf8')).version;
  assert.notEqual(bootstrap, expected, 'Install an older updater-capable bootstrap to verify an actual upgrade.');
  const settings = createSettingsStore(profile);
  settings.saveMessage('PRESERVE LIVE UPDATE MESSAGE');
  const original = path.join(appData, 'selected-effect.wav');
  fs.writeFileSync(original, require('./audio-fixture').audioFixture());
  const sound = await importSound(profile, original, async () => {});
  settings.saveSound(sound.setting);
  settings.saveAutoUpdates(true);
  fs.unlinkSync(original);
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const settingsHash = digest(settings.file);
  const soundFile = path.join(profile, 'sounds', sound.setting.file);
  const soundHash = digest(soundFile);
  const env = { ...process.env, APPDATA: appData, OPENWHIP_TEST_CLI: cli };
  delete env.OPENWHIP_DISABLE_UPDATE_CHECKS;
  let appStarted = false;
  try {
    await exec(process.execPath, [cli], { env });
    appStarted = true;
    const initial = readJSON(path.join(profile, 'status.json'));
    assert.equal(initial.version, bootstrap);
    let previousPhase;
    const deadline = Date.now() + 300000;
    let final;
    while (Date.now() < deadline) {
      const status = readJSON(path.join(profile, 'status.json'));
      const handoff = readJSON(path.join(profile, 'updates', 'handoff.json'));
      const phase = handoff?.phase === 'complete' ? 'complete' : status?.update?.phase;
      if (phase !== previousPhase) { console.log(`Live GitHub update: ${phase}`); previousPhase = phase; }
      if (status?.update?.phase === 'error' || handoff?.phase === 'rolled-back' || handoff?.phase === 'error') throw new Error(status.update?.error || handoff.error);
      if (status?.running && status.version === expected && handoff?.phase === 'complete') { final = status; break; }
      await delay(250);
    }
    assert.ok(final, 'Automatic update did not finish.');
    assert.notEqual(final.pid, initial.pid);
    assert.ok(final.appPath.startsWith(path.join(profile, 'updates', 'runtimes')));
    assert.equal(final.messageMode, 'custom');
    assert.equal(final.soundMode, 'custom');
    assert.equal(digest(settings.file), settingsHash);
    assert.equal(digest(soundFile), soundHash);
    const version = await exec(process.execPath, [cli, '--version'], { env });
    assert.ok(version.stdout.includes(expected), 'Global launcher did not select the new runtime.');
    await exec(process.execPath, [cli, '--quit'], { env });
    appStarted = false;
    const native = await exec(process.execPath, [path.join(__dirname, 'smoke-windows.js'), '--installed'], { env, timeout: 90000 });
    console.log(native.stdout);
    assert.equal(readJSON(path.join(profile, 'status.json')).lastSound.mode, 'custom');
    assert.equal(digest(settings.file), settingsHash);
    fs.writeFileSync(path.join(output, 'live-update-smoke.json'), JSON.stringify({ passed: true, from: bootstrap, to: expected, profile, activeRuntime: final.appPath, checks: ['Real GitHub metadata and pinned-commit npm download.', 'Startup check upgraded the globally installed launcher without a manual check.', 'New Electron process and global CLI both use the newer version.', 'Custom text, audio bytes and preferences preserved exactly.', 'Upgraded runtime passed native mouse, input and custom-sound playback checks.'] }, null, 2) + '\n');
    console.log(`Live automatic update ${bootstrap} → ${expected} passed; settings and sound preserved.`);
  } finally {
    if (appStarted) await exec(process.execPath, [cli, '--quit'], { env }).catch(() => {});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
