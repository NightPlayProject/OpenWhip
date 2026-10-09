const test = require('node:test');
const assert = require('node:assert/strict');
const { MacroRunner } = require('../lib/macro');
const { parseOptions } = require('../lib/options');

function fixture() {
  const events = [];
  let active = true;
  const input = {
    isActive: () => active,
    waitForRelease: async () => events.push('release'),
    interrupt: () => events.push('interrupt'),
    type: (_target, text) => events.push(['type', text]),
    enter: () => events.push('enter'),
  };
  return { events, input, leave: () => { active = false; } };
}

test('interrupt settles before text; Enter is sent once after text settles', async () => {
  const f = fixture();
  const runner = new MacroRunner(f.input, { message: 'Go faster', interruptDelay: 500, enterDelay: 150 }, async ms => f.events.push(['wait', ms]));
  assert.deepEqual(await runner.run({ handle: 1 }), { sent: true });
  assert.deepEqual(f.events, ['release', 'interrupt', ['wait', 500], ['type', 'Go faster'], ['wait', 150], 'release', 'enter']);
});

test('switching apps during interrupt delay cancels all text and Enter', async () => {
  const f = fixture();
  const runner = new MacroRunner(f.input, {}, async () => f.leave());
  await assert.rejects(runner.run({ handle: 1 }), /Active app changed/);
  assert.deepEqual(f.events, ['release', 'interrupt']);
  assert.equal(runner.busy, false);
});

test('switching apps after typing cancels Enter', async () => {
  const f = fixture();
  let waits = 0;
  const runner = new MacroRunner(f.input, { message: 'TEST' }, async () => { if (++waits === 2) f.leave(); });
  await assert.rejects(runner.run({ handle: 1 }), /Active app changed/);
  assert.ok(f.events.some(item => Array.isArray(item) && item[0] === 'type'));
  assert.equal(f.events.includes('enter'), false);
});

test('focus changes while shortcut modifiers are held cancel the interrupt', async () => {
  const f = fixture();
  f.input.waitForRelease = async () => f.leave();
  await assert.rejects(new MacroRunner(f.input).run({ handle: 1 }), /Active app changed/);
  assert.deepEqual(f.events, []);
});

test('overlapping cracks are dropped rather than queued into another app', async () => {
  const f = fixture();
  let release;
  f.input.waitForRelease = () => new Promise(resolve => { release = resolve; });
  const runner = new MacroRunner(f.input, {}, async () => {});
  const first = runner.run({ handle: 1 });
  await Promise.resolve();
  assert.deepEqual(await runner.run({ handle: 2 }), { sent: false, reason: 'busy' });
  f.leave();
  release();
  await assert.rejects(first, /Active app changed/);
  assert.deepEqual(f.events, []);
});

test('failed input does not submit or leave the runner locked', async () => {
  const f = fixture();
  f.input.type = () => { throw new Error('Input rejected'); };
  const runner = new MacroRunner(f.input, {}, async () => {});
  await assert.rejects(runner.run({ handle: 1 }), /Input rejected/);
  assert.equal(runner.busy, false);
  assert.equal(f.events.includes('enter'), false);
});

test('missing foreground app produces no keyboard events', async () => {
  const f = fixture();
  await assert.rejects(new MacroRunner(f.input).run(null), /Focus the app/);
  assert.deepEqual(f.events, []);
});

test('CLI accepts Unicode single-line messages and bounded timings', () => {
  assert.equal(parseOptions(['--message', 'Go faster 🐸', '--interrupt-delay', '900']).interruptDelay, 900);
  for (const args of [['--message', 'line\nsubmit'], ['--message', '\x1b'], ['--enter-delay', '-1'], ['--interrupt-delay', 'NaN'], ['--unknown'], ['--quit', '--status']]) {
    assert.throws(() => parseOptions(args));
  }
});
