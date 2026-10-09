#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { parseOptions } = require('../lib/options');
const { directory, logPath, readStatus } = require('../lib/state');
const pkg = require('../package.json');

const HELP = `OpenWhip NightPlay ${pkg.version}

Usage: openwhip [options]

  --message TEXT          Use this message instead of a random phrase
  --interrupt-delay MS    Wait after Ctrl+C (default: 500)
  --enter-delay MS        Wait before Enter (default: 150)
  --status                Show whether the tray app is running
  --quit                  Quit the tray app
  --version               Show the installed version
  --help                  Show this help

Global shortcuts:
  Ctrl+Alt+W              Pick up / drop the whip
  Ctrl+Alt+Enter          Send Ctrl+C, message, then Enter to the active app
  Escape                 Drop the whip while it is visible

Keep the desired text field focused. Switching apps cancels remaining keys.
Log: ${logPath}`;

async function main() {
  const args = process.argv.slice(2);
  const options = parseOptions(args);
  if (options.command === 'help') return console.log(HELP);
  if (options.command === 'version') return console.log(`${pkg.name} ${pkg.version}`);
  const current = readStatus();
  if (options.command === 'status') return console.log(JSON.stringify(current, null, 2));
  if (options.command === 'start' && current.running) {
    console.log(`OpenWhip is already running (PID ${current.pid}). Use openwhip --quit before changing options.`);
    return;
  }
  if (options.command === 'quit' && !current.running) return console.log('OpenWhip is already stopped.');

  const electronBinary = require('electron');
  fs.mkdirSync(directory, { recursive: true });
  const log = fs.openSync(logPath, 'a');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let child;
  try {
    child = spawn(electronBinary, [path.resolve(__dirname, '..'), ...args], {
      detached: true, stdio: ['ignore', log, log], windowsHide: true, env,
    });
  } finally {
    fs.closeSync(log);
  }
  let launchError;
  let exitCode;
  child.once('error', error => { launchError = error; });
  child.once('exit', code => { exitCode = code; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    const status = readStatus();
    if (options.command === 'quit' ? !status.running : status.running && status.pid === child.pid) {
      child.unref();
      console.log(options.command === 'quit' ? 'OpenWhip stopped.' : 'OpenWhip ready. Ctrl+Alt+W: whip. Ctrl+Alt+Enter: send to the active app.');
      return;
    }
    if (exitCode !== undefined && options.command !== 'quit') break;
    await delay(100);
  }
  child.unref();
  throw new Error(`OpenWhip did not ${options.command === 'quit' ? 'stop' : 'start'}. See ${logPath}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
