const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

async function main() {
  const output = path.resolve(__dirname, '..', 'out', 'validation');
  const appData = path.join(output, 'ui-runtime');
  fs.mkdirSync(appData, { recursive: true });
  for (const phase of ['edit', 'restart']) {
    const env = { ...process.env, APPDATA: appData, OPENWHIP_UI_SMOKE_PHASE: phase, OPENWHIP_DISABLE_UPDATE_CHECKS: '1' };
    if (process.argv.includes('--installed')) env.OPENWHIP_UI_SMOKE_APP = path.join(process.env.APPDATA, 'npm', 'node_modules', '@nightplayproject', 'openwhip', 'main.js');
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [path.join(__dirname, 'ui-smoke.js')], { env, stdio: 'inherit', windowsHide: true });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('UI smoke test timed out.')); }, 20000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`UI smoke test exited with ${code}.`)); });
    });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
