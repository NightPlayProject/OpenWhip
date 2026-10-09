const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Updater, CHECK_INTERVAL } = require('../lib/updater');
const { checkGitHub } = require('../lib/update-feed');
const { compareVersions, resolveRuntime, writeJSON, readJSON } = require('../lib/runtime');
const { handoff } = require('../bin/update-helper');
const sha = 'a'.repeat(40);

function temporary(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openwhip-update-test-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  return profile;
}
function updater(profile, overrides = {}) {
  const states = [];
  const manager = new Updater({ profile, version: '1.5.0', supported: true, enabled: true,
    onStatus: value => states.push({ ...value }), onReady() {}, now: () => CHECK_INTERVAL * 10,
    feed: async () => ({ version: '1.5.1', sha }), prepare: async release => ({ ...release, directory: 'runtimes/1.5.1-aaaaaaaaaaaa' }), ...overrides });
  return { manager, states };
}

test('GitHub metadata resolves an immutable commit and rejects a different package', async () => {
  const urls = [];
  const fetcher = async url => {
    urls.push(url);
    return new Response(JSON.stringify(url.includes('api.github.com') ? { sha } : { name: '@nightplayproject/openwhip', version: '1.5.1' }));
  };
  assert.deepEqual(await checkGitHub(fetcher), { version: '1.5.1', sha });
  assert.ok(urls[1].includes(`/${sha}/package.json`));
  await assert.rejects(checkGitHub(async url => new Response(JSON.stringify(url.includes('api.github.com') ? { sha } : { name: 'another-app', version: '1.5.1' }))), /wrong package/);
  await assert.rejects(checkGitHub(async () => new Response(JSON.stringify({ sha: '../main' }))), /invalid commit/);
});

test('updates stage once without changing the active runtime or user settings', async t => {
  const profile = temporary(t);
  writeJSON(path.join(profile, 'settings.json'), { message: 'Keep this', sound: 'keep this too' });
  const before = fs.readFileSync(path.join(profile, 'settings.json'));
  let prepared = 0;
  const { manager, states } = updater(profile, { prepare: async release => { prepared++; return release; } });
  await manager.check();
  await manager.check(true);
  assert.equal(prepared, 1);
  assert.equal(manager.pending.version, '1.5.1');
  assert.equal(states.at(-1).phase, 'ready');
  assert.equal(states.at(-1).busy, false, 'Tray controls must re-enable after a check.');
  assert.equal(fs.existsSync(path.join(profile, 'updates', 'active.json')), false);
  assert.deepEqual(fs.readFileSync(path.join(profile, 'settings.json')), before);
});

test('disabled checks, development copies, downgrades and six-hour throttling do not install', async t => {
  const profile = temporary(t);
  let calls = 0;
  for (const options of [{ enabled: false }, { supported: false }, { feed: async () => ({ version: '1.4.0', sha }) }]) {
    const { manager } = updater(profile, { prepare: async () => { calls++; }, ...options });
    await manager.check();
    assert.equal(manager.pending, null);
  }
  const { manager } = updater(profile, { prepare: async () => { calls++; } });
  await manager.check();
  assert.equal(calls, 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.throws(() => compareVersions('main; command', '1.0.0'));
});

test('concurrent checks share one download; failed downloads can retry and retain old runtime', async t => {
  const profile = temporary(t);
  const active = path.join(profile, 'updates', 'active.json');
  writeJSON(active, { version: '1.4.0' });
  let calls = 0, release;
  const { manager } = updater(profile, { prepare: async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error('Offline'); } });
  const first = manager.check();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await manager.check(true);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(manager.status.phase, 'error');
  assert.equal(readJSON(active).version, '1.4.0');
  assert.equal(readJSON(manager.file).checkedAt, 0);
});

test('launcher accepts verified newer runtimes and rejects traversal and mismatched identities', t => {
  const profile = temporary(t), installed = path.join(profile, 'original');
  const pointer = { version: '1.5.1', sha, directory: 'runtimes/1.5.1-aaaaaaaaaaaa' };
  const runtime = path.join(profile, 'updates', pointer.directory);
  const root = path.join(runtime, 'node_modules', '@nightplayproject', 'openwhip');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  writeJSON(path.join(root, 'package.json'), { name: '@nightplayproject/openwhip', version: '1.5.1' });
  for (const file of ['main.js', 'preload.js', 'overlay.html', 'bin/openwhip.js']) fs.writeFileSync(path.join(root, file), '');
  writeJSON(path.join(runtime, 'installed.json'), { version: pointer.version, sha });
  writeJSON(path.join(profile, 'updates', 'active.json'), pointer);
  assert.equal(resolveRuntime(profile, installed, '1.5.0'), root);
  assert.equal(resolveRuntime(profile, installed, '1.6.0'), installed);
  writeJSON(path.join(profile, 'updates', 'active.json'), { ...pointer, directory: '../outside' });
  assert.equal(resolveRuntime(profile, installed, '1.5.0'), installed);
  writeJSON(path.join(profile, 'updates', 'active.json'), pointer);
  writeJSON(path.join(root, 'package.json'), { name: 'another-app', version: '1.5.1' });
  assert.equal(resolveRuntime(profile, installed, '1.5.0'), installed);
});

test('failed restart rolls back the active pointer and actually launches the previous copy', async t => {
  const profile = temporary(t);
  const fallback = path.join(profile, 'fallback');
  const broken = path.join(profile, 'broken');
  fs.mkdirSync(path.join(fallback, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(broken, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'updates'));
  const previous = { version: '1.4.0', sha: 'b'.repeat(40), directory: 'runtimes/1.4.0-bbbbbbbbbbbb' };
  writeJSON(path.join(profile, 'updates', 'active.json'), previous);
  fs.writeFileSync(path.join(broken, 'bin', 'openwhip.js'), 'process.exit(1);');
  fs.writeFileSync(path.join(fallback, 'bin', 'openwhip.js'), `require('fs').writeFileSync(${JSON.stringify(path.join(profile, 'status.json'))}, JSON.stringify({ running:true,pid:process.pid,appPath:${JSON.stringify(fallback)} }));setTimeout(()=>{},600);`);
  await handoff({ profile, parentPid: 2147483600, node: process.execPath, fallbackPath: fallback, installRoot: fallback, release: { version: '1.5.1', sha, directory: 'runtimes/1.5.1-aaaaaaaaaaaa', appPath: broken }, args: [] });
  assert.deepEqual(readJSON(path.join(profile, 'updates', 'active.json')), previous);
  assert.equal(readJSON(path.join(profile, 'updates', 'handoff.json')).phase, 'rolled-back');
  assert.equal(readJSON(path.join(profile, 'status.json')).appPath, fallback);
  assert.equal(readJSON(path.join(profile, 'updates', 'check.json')).failedSha, sha);
  await new Promise(resolve => setTimeout(resolve, 650));
});
