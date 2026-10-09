const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { createWindowsInput } = require('../lib/windows-input');
const { MacroRunner } = require('../lib/macro');
const { readStatus } = require('../lib/state');
const exec = promisify(execFile);

async function main() {
  assert.equal(process.platform, 'win32', 'Run this test on Windows.');
  assert.equal(readStatus().running, false, 'Quit OpenWhip before running the desktop smoke test.');
  const output = path.resolve(__dirname, '..', 'out', 'validation');
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'receiver.json');
  const commandPath = path.join(output, 'receiver-command.txt');
  for (const file of [reportPath, commandPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
  const receiver = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'native-receiver.ps1'), '-Report', reportPath, '-Command', commandPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let receiverErrors = '';
  receiver.stderr.on('data', chunk => { receiverErrors += chunk; });
  const cli = process.argv.includes('--installed')
    ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@nightplayproject', 'openwhip', 'bin', 'openwhip.js')
    : path.resolve(__dirname, '..', 'bin', 'openwhip.js');
  const input = createWindowsInput();
  const read = () => {
    try { return JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, '')); }
    catch { return null; }
  };
  async function until(predicate, message, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      if (receiver.exitCode !== null) throw new Error(`Receiver exited: ${receiverErrors}`);
      await delay(40);
    }
    throw new Error(`${message}\nReport: ${JSON.stringify(read())}\nCaptured: ${JSON.stringify(input.captureTarget())}\n${receiverErrors}`);
  }
  function command(text) { fs.writeFileSync(commandPath, text); }
  const results = [];
  let appStarted = false;
  try {
    await until(() => read()?.a.handle, 'Receiver did not start.');
    let report = read();
    const targetA = { handle: report.a.handle, pid: report.pid };
    const targetB = { handle: report.b.handle, pid: report.pid };
    command('focus-a');
    await until(() => input.isActive(targetA), 'Receiver A did not get focus.');
    assert.equal(input.inputSize, process.arch === 'ia32' ? 28 : 40);

    await new MacroRunner(input, { message: 'OpenWhip TEST' }).run(targetA);
    await until(() => read()?.a.submitted.length === 1, 'Automatic Enter was not received.');
    report = read();
    assert.deepEqual(report.a.submitted, ['OpenWhip TEST']);
    assert.equal(report.a.interrupts, 1);
    assert.equal(report.b.text, '');
    assert.deepEqual(report.b.submitted, []);
    results.push('Native window received Ctrl+C, exact text, and one unmodified Enter; other window untouched.');

    command('reset-a');
    await until(() => read()?.a.text === '' && read()?.a.interrupts === 0, 'Receiver did not reset.');
    await new MacroRunner(input, { message: 'Faster café 🐸' }).run(targetA);
    await until(() => read()?.a.submitted.length === 1, 'Unicode submission failed.');
    assert.deepEqual(read().a.submitted, ['Faster café 🐸']);
    results.push('Unicode and case reached the native text box exactly.');

    command('reset-a');
    await until(() => read()?.a.text === '' && read()?.a.interrupts === 0, 'Receiver did not reset.');
    const cancelled = new MacroRunner(input, { message: 'MUST NOT ARRIVE', interruptDelay: 1000 }).run(targetA);
    const cancellationCheck = assert.rejects(cancelled, /Active app changed/);
    await until(() => read()?.a.interrupts === 1, 'Interrupt was not received.');
    command('focus-b');
    await until(() => input.isActive(targetB), 'Receiver B did not get focus.');
    await cancellationCheck;
    assert.equal(read().a.text, '');
    assert.deepEqual(read().a.submitted, []);
    assert.equal(read().b.text, '');
    assert.deepEqual(read().b.submitted, []);
    results.push('Switching foreground windows after Ctrl+C cancelled all text and Enter.');

    command('reset-a');
    await until(() => input.isActive(targetA) && read()?.a.interrupts === 0, 'Receiver A did not reset.');
    await exec(process.execPath, [cli, '--message', 'GLOBAL TEST'], { env: { ...process.env, OPENWHIP_DISABLE_UPDATE_CHECKS: '1' } });
    appStarted = true;
    assert.equal(readStatus().shortcuts['Control+Alt+Enter'], undefined);
    assert.equal(readStatus().shortcuts['Control+Alt+W'], true);
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const key = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
    function shortcut(vk) {
      assert.equal(input.isActive(targetA), true, 'Refuse to send test keys outside receiver A.');
      for (const value of [0x11, 0x12, vk]) key(value, 0, 0, 0);
      for (const value of [vk, 0x12, 0x11]) key(value, 0, 2, 0);
    }
    shortcut(0x0d);
    await delay(900);
    assert.equal(read().a.interrupts, 0);
    assert.deepEqual(read().a.submitted, []);
    results.push('Ctrl+Alt+Enter is unregistered and sends no macro.');
    const pointType = koffi.struct({ x: 'int32_t', y: 'int32_t' });
    const getCursor = user32.func('__stdcall', 'GetCursorPos', 'int', [koffi.out(koffi.pointer(pointType))]);
    const setCursor = user32.func('int __stdcall SetCursorPos(int x, int y)');
    const metrics = user32.func('int __stdcall GetSystemMetrics(int index)');
    const originalCursor = {};
    assert.ok(getCursor(originalCursor));
    const width = metrics(0);
    const height = metrics(1);
    try {
      const click = read().a.clickPoint;
      setCursor(click.x, click.y);
      shortcut(0x57);
      await until(() => readStatus().overlay?.ready && readStatus().overlay?.visible, 'Overlay did not load.');
      assert.equal(input.isActive(targetA), true, 'Overlay stole keyboard focus.');
      assert.equal(readStatus().overlay.clickThrough, true);
      const ticks = read().a.ticks;
      await delay(160);
      assert.ok(read().a.ticks > ticks + 1, 'Underlying app stopped processing its UI timer.');
      const mouse = user32.func('void __stdcall mouse_event(uint32_t flags, uint32_t dx, uint32_t dy, uint32_t data, uintptr_t extra)');
      mouse(2, 0, 0, 0, 0);
      await delay(80);
      mouse(4, 0, 0, 0, 0);
      await until(() => read()?.a.clicks === 1, 'Overlay blocked the underlying button click.');
      await until(() => readStatus().overlay?.visible === false, 'Click did not drop the whip.');
      assert.equal(read().a.interrupts, 0);
      results.push('Underlying native app kept processing UI events and received a real mouse click through the visible overlay.');
      const start = { x: Math.round(width * 0.5), y: Math.round(height * 0.55) };
      setCursor(start.x, start.y);
      shortcut(0x57);
      await until(() => readStatus().overlay?.visible, 'Whip did not reopen.');
      await delay(450);
      assert.equal(read().a.interrupts, 0, 'A stationary mouse caused a false crack.');
      async function move(from, dx, dy, duration) {
        const started = performance.now();
        while (performance.now() - started < duration) {
          assert.equal(input.isActive(targetA), true, 'Refuse to flick outside the test receiver.');
          const amount = Math.min(1, (performance.now() - started) / duration);
          assert.ok(setCursor(Math.round(from.x + dx * amount), Math.round(from.y + dy * amount)));
          await delay(8);
        }
        assert.ok(setCursor(from.x + dx, from.y + dy));
      }
      await move(start, 70, 0, 500);
      await delay(200);
      assert.equal(read().a.interrupts, 0, 'Slow mouse movement caused a false crack.');
      const from = { x: start.x + 70, y: start.y };
      await move(from, 140, -35, 90);
      await until(() => read()?.a.submitted.length === 1, 'A natural 140 px mouse flick did not crack the whip and submit.');
      assert.deepEqual(read().a.submitted, ['GLOBAL TEST']);
      assert.equal(read().a.interrupts, 1);
      await delay(500);
      assert.equal(read().a.interrupts, 1, 'Rope settling repeated the macro.');
      results.push('Idle and slow OS cursor movement produced no macro; one natural 140 px / 90 ms flick submitted exactly once.');
      command('reset-a');
      await until(() => read()?.a.interrupts === 0 && read()?.a.text === '', 'Receiver did not reset for the return flick.');
      await move({ x: from.x + 140, y: from.y - 35 }, -140, 35, 90);
      await until(() => read()?.a.submitted.length === 1, 'A deliberate return flick did not rearm and submit.');
      assert.deepEqual(read().a.submitted, ['GLOBAL TEST']);
      assert.equal(read().a.interrupts, 1);
      results.push('A second deliberate flick after rest rearmed and submitted exactly once.');
    } finally { setCursor(originalCursor.x, originalCursor.y); }
    // Escape is captured only while the whip is visible.
    key(0x1b, 0, 0, 0); key(0x1b, 0, 2, 0);
    await until(() => readStatus().overlay?.visible === false, 'Escape did not drop the whip.');
    assert.deepEqual(read().a.submitted, ['GLOBAL TEST']);
    assert.equal(read().b.text, '');
    results.push('Mouse movement through the real overlay cracked the animated whip and automatically submitted to the native app.');
    const pid = readStatus().pid;
    const repeated = await exec(process.execPath, [cli]);
    assert.match(repeated.stdout, /already running/);
    assert.equal(readStatus().pid, pid);
    await exec(process.execPath, [cli, '--quit']);
    appStarted = false;
    assert.equal(readStatus().running, false);
    results.push('Escape, single-instance launch, and clean CLI shutdown passed.');
    const result = { passed: true, package: require('../package.json').name, version: require('../package.json').version, installedPackage: process.argv.includes('--installed'), at: new Date().toISOString(), results };
    fs.writeFileSync(path.join(output, process.argv.includes('--installed') ? 'windows-smoke-installed.json' : 'windows-smoke-source.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (appStarted || readStatus().running) await exec(process.execPath, [cli, '--quit']).catch(() => {});
    command('quit');
    await Promise.race([new Promise(resolve => receiver.once('exit', resolve)), delay(2000)]);
    if (receiver.exitCode === null) receiver.kill();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
