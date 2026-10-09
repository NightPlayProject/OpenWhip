const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'motion-visual.js')], { env, stdio: 'inherit', windowsHide: true });
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 25000);
child.once('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.once('exit', code => { clearTimeout(timeout); process.exitCode = timedOut || code === null ? 1 : code; });
