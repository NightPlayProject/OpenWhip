const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const output = path.resolve(__dirname, '..', 'out', 'validation');
fs.mkdirSync(path.join(output, 'motion-runtime'), { recursive: true });
app.setPath('userData', path.join(output, 'motion-runtime'));
const clock = () => performance.timeOrigin + performance.now();

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 900, height: 600, useContentSize: true, show: false, frame: false,
    focusable: false, skipTaskbar: true, backgroundColor: '#252b38',
    webPreferences: { preload: path.resolve(__dirname, '..', 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.setIgnoreMouseEvents(true);
  let cracks = 0;
  ipcMain.on('whip-crack', event => { if (event.sender === window.webContents) cracks++; });
  await window.loadFile(path.resolve(__dirname, '..', 'overlay.html'));
  window.showInactive();
  let pointer = { x: 300, y: 350 };
  const poses = [];
  async function snapshot(label) {
    const points = await window.webContents.executeJavaScript('motion.renderPoints()');
    assert.ok(Math.hypot(points[0].x - pointer.x, points[0].y - pointer.y) < 1, 'Grip lagged behind the latest pointer.');
    const image = await window.webContents.capturePage();
    const file = path.join(output, `motion-pose-${poses.length}.png`);
    fs.writeFileSync(file, image.toPNG());
    poses.push({ label, data: image.toPNG().toString('base64'), points });
  }
  window.webContents.send('spawn-whip', { ...pointer, time: clock() });
  let started = clock();
  while (clock() - started < 400) {
    window.webContents.send('cursor-state', { ...pointer, time: clock() });
    await delay(8);
  }
  assert.equal(cracks, 0);
  await snapshot('At rest');
  started = clock();
  while (clock() - started < 90) {
    const amount = Math.min(1, (clock() - started) / 90);
    pointer = { x: 300 + 140 * amount, y: 350 - 35 * amount };
    window.webContents.send('cursor-state', { ...pointer, time: clock() });
    await delay(8);
  }
  pointer = { x: 440, y: 315 };
  window.webContents.send('cursor-state', { ...pointer, time: clock() });
  await delay(16);
  await snapshot('End of flick');
  assert.equal(cracks, 1);
  await delay(130);
  await snapshot('Tail follows');
  await delay(900);
  await snapshot('Settled');
  assert.equal(cracks, 1, 'Physics settling generated an extra crack.');
  const staleStart = clock() - 700;
  for (let time = 0; time <= 296; time += 8) {
    const progress = Math.max(0, Math.min(1, (time - 200) / 90));
    window.webContents.send('cursor-state', { x: pointer.x + progress * 140, y: pointer.y, time: staleStart + time });
  }
  await delay(80);
  assert.equal(cracks, 1, 'A stale queued stroke was replayed.');
  const first = poses[0].points, moving = poses[1].points;
  assert.ok(Math.hypot(moving.at(-1).x - first.at(-1).x - 140, moving.at(-1).y - first.at(-1).y + 35) > 30,
    'The tail moved as a rigid cursor sprite instead of carrying inertia.');
  window.hide();
  const sheet = new BrowserWindow({ width: 960, height: 700, useContentSize: true, show: false, frame: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const html = `<html><body style="margin:0;background:#171d29;display:grid;grid-template-columns:1fr 1fr;color:#fff;font:18px Segoe UI">${poses.map(pose => `<section style="height:350px"><div style="height:30px;padding:6px 18px;box-sizing:border-box;font-size:14px">${pose.label}</div><img style="width:480px;height:320px" src="data:image/png;base64,${pose.data}"></section>`).join('')}</body></html>`;
  await sheet.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  await sheet.webContents.executeJavaScript('Promise.all(Array.from(document.images, image => image.decode()))');
  fs.writeFileSync(path.join(output, 'motion-contact-sheet.png'), (await sheet.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'motion-render.json'), JSON.stringify({ passed: true, cracks, poses: poses.map(({ label, points }) => ({ label, points })) }, null, 2) + '\n');
  console.log('Real renderer: exact grip position, flexible tail, one natural flick, no settling cracks, and stale-input cancellation passed.');
  app.quit();
}

main().catch(error => { console.error(error); app.exit(1); });
