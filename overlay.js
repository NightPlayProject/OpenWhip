const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const motion = new WhipMotion();
const sounds = ['A', 'B', 'C', 'D', 'E'].map(name => new Audio(`sounds/${name}.mp3`));
let width, height, frame = null;
const now = () => performance.timeOrigin + performance.now();

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
resize();
window.addEventListener('resize', resize);

function splinePoint(points, index) {
  if (index < 0) return { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
  if (index >= points.length) {
    const a = points.at(-2), b = points.at(-1);
    return { x: 2 * b.x - a.x, y: 2 * b.y - a.y };
  }
  return points[index];
}

function curve(points, index) {
  const a = splinePoint(points, index - 1), b = points[index];
  const c = points[index + 1], d = splinePoint(points, index + 2);
  ctx.bezierCurveTo(b.x + (c.x - a.x) / 6, b.y + (c.y - a.y) / 6,
    c.x - (d.x - b.x) / 6, c.y - (d.y - b.y) / 6, c.x, c.y);
}

function draw(time) {
  ctx.clearRect(0, 0, width, height);
  const points = motion.renderPoints();
  if (!points.length) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [color, extra] of [['#fff', 6], ['#111', 0]]) {
    ctx.strokeStyle = color;
    for (let index = 0; index < points.length - 1; index++) {
      ctx.beginPath();
      ctx.moveTo(points[index].x, points[index].y);
      curve(points, index);
      ctx.lineWidth = (index < 2 ? 12 : 7 - index / (points.length - 1) * 2) + extra;
      ctx.stroke();
    }
  }
  const age = time - motion.crackAt;
  if (age >= 0 && age < 130 && !motion.dropping) {
    const tip = points.at(-1);
    ctx.globalAlpha = 1 - age / 130;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for (let index = 0; index < 5; index++) {
      const angle = index * Math.PI * 2 / 5;
      ctx.beginPath();
      ctx.moveTo(tip.x + Math.cos(angle) * 8, tip.y + Math.sin(angle) * 8);
      ctx.lineTo(tip.x + Math.cos(angle) * 18, tip.y + Math.sin(angle) * 18);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function loop() {
  frame = null;
  const time = now();
  motion.advance(time);
  draw(time);
  if (motion.active) frame = requestAnimationFrame(loop);
  else window.bridge.hideOverlay();
}

window.bridge.onSpawnWhip(point => {
  motion.spawn(point);
  if (frame === null) frame = requestAnimationFrame(loop);
});
window.bridge.onCursorState(point => {
  // Do not replay a gesture that sat in the IPC queue while the renderer was busy.
  if (now() - point.time > 120) return;
  if (motion.input(point)) {
    const sound = sounds[Math.floor(Math.random() * sounds.length)];
    sound.currentTime = 0;
    sound.play().catch(() => {});
    window.bridge.whipCrack();
  }
});
window.bridge.onRebaseWhip(offset => motion.rebase(offset.x, offset.y));
window.bridge.onDropWhip(() => motion.drop(now()));
window.bridge.onStopWhip(() => {
  motion.stop();
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  ctx.clearRect(0, 0, width, height);
});
