#!/usr/bin/env node
// Copied outside the running package before restart so either version can be recovered.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function write(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

async function handoff(plan) {
  const activeFile = path.join(plan.profile, 'updates', 'active.json');
  const reportFile = path.join(plan.profile, 'updates', 'handoff.json');
  const previous = read(activeFile);
  const report = values => write(reportFile, { ...values, at: Date.now() });
  const deadline = Date.now() + 30000;
  while (alive(plan.parentPid)) {
    if (Date.now() > deadline) throw new Error('The running app did not stop; update cancelled.');
    await delay(100);
  }
  async function launch(appPath) {
    const env = { ...process.env, OPENWHIP_NODE_BINARY: plan.node, OPENWHIP_INSTALL_ROOT: plan.installRoot };
    delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(plan.profile, 'openwhip.log'), 'a');
    let child;
    try { child = spawn(plan.node, [path.join(appPath, 'bin', 'openwhip.js'), ...plan.args], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env }); }
    finally { fs.closeSync(log); }
    let error;
    child.once('error', value => { error = value; });
    child.unref();
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (error) throw error;
      const status = read(path.join(plan.profile, 'status.json'));
      if (status?.running && status.appPath === appPath && alive(status.pid)) return;
      if (child.exitCode !== null && child.exitCode !== 0) break;
      await delay(100);
    }
    throw new Error('Updated app did not start.');
  }
  report({ phase: 'restarting', version: plan.release.version });
  write(activeFile, { version: plan.release.version, sha: plan.release.sha, directory: plan.release.directory });
  try {
    await launch(plan.release.appPath);
    report({ phase: 'complete', version: plan.release.version });
  } catch (error) {
    if (previous) write(activeFile, previous);
    else if (fs.existsSync(activeFile)) fs.unlinkSync(activeFile);
    const checkFile = path.join(plan.profile, 'updates', 'check.json');
    write(checkFile, { ...(read(checkFile) || {}), failedSha: plan.release.sha });
    await launch(plan.fallbackPath);
    report({ phase: 'rolled-back', error: error.message });
  }
}

if (require.main === module) {
  const plan = read(process.argv[2]);
  handoff(plan).catch(error => {
    if (plan?.profile) write(path.join(plan.profile, 'updates', 'handoff.json'), { phase: 'error', error: error.message, at: Date.now() });
    process.exitCode = 1;
  });
}
module.exports = { handoff };
