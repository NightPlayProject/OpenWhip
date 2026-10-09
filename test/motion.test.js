const test = require('node:test');
const assert = require('node:assert/strict');
const { WhipMotion } = require('../lib/whip-motion');

function replay(path, fps = 60, duration = 2400, sampleInterval = 8) {
  const motion = new WhipMotion();
  motion.spawn({ ...path(0), time: 0 });
  let sample = sampleInterval, frame = 1000 / fps, maxStretch = 0, maxAnchorError = 0;
  const cracks = [];
  while (Math.min(sample, frame) <= duration) {
    if (sample <= frame) {
      if (motion.input({ ...path(sample), time: sample })) cracks.push(sample);
      sample += sampleInterval;
    } else {
      motion.advance(frame);
      const points = motion.renderPoints();
      if (points.length) {
        const pointer = path(sample - sampleInterval);
        maxAnchorError = Math.max(maxAnchorError, Math.hypot(pointer.x - points[0].x, pointer.y - points[0].y));
        for (let index = 0; index < motion.lengths.length; index++) {
          const a = motion.points[index], b = motion.points[index + 1];
          assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
          maxStretch = Math.max(maxStretch, Math.hypot(b.x - a.x, b.y - a.y) / motion.lengths[index]);
        }
      }
      frame += 1000 / fps;
    }
  }
  motion.advance(duration);
  return { motion, cracks, maxStretch, maxAnchorError };
}

const flick = (time, dx = 140, dy = -35) => {
  const progress = Math.max(0, Math.min(1, (time - 600) / 90));
  return { x: 700 + dx * progress, y: 550 + dy * progress };
};

test('a natural 140 px flick cracks once at 30, 60, 144 and 240 Hz', () => {
  const results = [30, 60, 144, 240].map(fps => replay(flick, fps));
  for (const result of results) {
    assert.equal(result.cracks.length, 1);
    assert.ok(result.cracks[0] >= 600 && result.cracks[0] <= 700);
    assert.ok(result.maxStretch <= 1.041);
    assert.ok(result.maxAnchorError < 0.001);
  }
  const tips = results.map(result => result.motion.points.at(-1));
  for (const tip of tips) assert.ok(Math.hypot(tip.x - tips[0].x, tip.y - tips[0].y) < 5, 'Refresh rate changed the settled rope.');
});

test('idle, slow movement and tiny jitter never send a message', () => {
  for (const path of [
    () => ({ x: 700, y: 550 }),
    time => ({ x: 700 + time * 0.15, y: 550 + Math.sin(time / 300) * 10 }),
    time => ({ x: 700 + Math.sin(time) * 3, y: 550 + Math.cos(time) * 3 }),
  ]) {
    assert.deepEqual(replay(path, 144, 4000).cracks, []);
  }
});

test('horizontal, vertical and diagonal strokes work in both directions', () => {
  for (const [dx, dy] of [[140, 0], [-140, 0], [0, 140], [0, -140], [100, 100], [-100, -100]]) {
    assert.equal(replay(time => flick(time, dx, dy)).cracks.length, 1);
  }
});

test('ordinary cursor sweeps and short fast movements do not crack the whip', () => {
  for (const [distance, duration] of [[80, 90], [100, 120], [140, 180], [70, 40]]) {
    for (const fps of [30, 60, 144, 240]) {
      const path = time => ({ x: 700 + distance * Math.max(0, Math.min(1, (time - 600) / duration)), y: 550 });
      assert.deepEqual(replay(path, fps).cracks, [], `${distance}px over ${duration}ms at ${fps}Hz should stay quiet.`);
    }
  }
});

test('continuous shaking produces one crack; a new deliberate stroke rearms after rest', () => {
  const shaking = time => ({ x: 700 + (time >= 600 ? Math.sin((time - 600) / 24) * 120 : 0), y: 550 });
  assert.equal(replay(shaking, 144, 2800).cracks.length, 1);
  const twoStrokes = time => {
    const a = Math.max(0, Math.min(1, (time - 600) / 90));
    const b = Math.max(0, Math.min(1, (time - 1900) / 90));
    return { x: 700 + a * 140 - b * 140, y: 550 };
  };
  assert.equal(replay(twoStrokes).cracks.length, 2);
});

test('monitor coordinate rebasing preserves the rope and does not create a crack', () => {
  const motion = replay(flick, 60, 450).motion;
  const before = motion.points.map(point => ({ ...point }));
  const time = motion.samples.at(-1).time;
  motion.rebase(-1920, 100);
  assert.equal(motion.input({ x: 700 - 1920, y: 650, time: time + 8 }), false);
  for (let index = 0; index < before.length; index++) {
    assert.ok(Math.abs(motion.points[index].x - before[index].x + 1920) < 0.001);
    assert.ok(Math.abs(motion.points[index].y - before[index].y - 100) < 0.001);
  }
});

test('stalled frames, stale samples and pointer teleports do not create cracks or unstable points', () => {
  const motion = replay(() => ({ x: 700, y: 550 }), 60, 500).motion;
  assert.equal(motion.input({ x: 2000, y: -300, time: 700 }), false);
  assert.equal(motion.input({ x: 0, y: 0, time: 600 }), false);
  motion.advance(1000);
  for (let time = 1008; time < 1800; time += 8) {
    assert.equal(motion.input({ x: 2000, y: -300, time }), false);
    motion.advance(time);
  }
  assert.ok(motion.points.every(point => [point.x, point.y, point.px, point.py].every(Number.isFinite)));
});

test('dropping ignores further gestures and stops after a bounded duration', () => {
  const motion = replay(() => ({ x: 700, y: 550 }), 60, 500).motion;
  motion.drop(500);
  assert.equal(motion.input({ x: 850, y: 550, time: 590 }), false);
  for (let time = 510; time <= 1160; time += 10) motion.advance(time);
  assert.equal(motion.active, false);
  assert.deepEqual(motion.renderPoints(), []);
});

test('different cursor polling rates still recognize a natural flick', () => {
  for (const interval of [4, 8, 16, 25]) assert.equal(replay(flick, 144, 2400, interval).cracks.length, 1);
});
