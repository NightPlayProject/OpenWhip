const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { REPOSITORY } = require('./update-feed');
const { validateRuntime, writeJSON, readJSON, isInside } = require('./runtime');
const exec = promisify(execFile);

function findNodeAndNpm(nodeHint = process.env.OPENWHIP_NODE_BINARY) {
  const directories = (process.env.PATH || '').split(path.delimiter);
  const node = nodeHint && fs.existsSync(nodeHint) ? nodeHint
    : directories.map(dir => path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node')).find(file => fs.existsSync(file));
  if (!node) throw new Error('Node.js is needed to install updates.');
  const candidates = [
    path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  if (process.env.npm_execpath?.endsWith('npm-cli.js')) candidates.push(process.env.npm_execpath);
  for (const dir of directories) {
    if (process.platform === 'win32') candidates.push(path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    else {
      try { const file = fs.realpathSync(path.join(dir, 'npm')); if (file.endsWith('.js')) candidates.push(file); } catch {}
    }
  }
  const npm = candidates.find(file => fs.existsSync(file));
  if (!npm) throw new Error('npm is needed to install updates.');
  return { node, npm };
}

async function prepareUpdate(profile, release, runtime = findNodeAndNpm()) {
  const directoryName = `runtimes/${release.version}-${release.sha.slice(0, 12)}`;
  const directory = path.join(profile, 'updates', directoryName);
  const marker = readJSON(path.join(directory, 'installed.json'));
  if (marker?.sha === release.sha && marker.version === release.version) {
    return { ...release, directory: directoryName, appPath: validateRuntime(directory, release), node: runtime.node };
  }
  fs.mkdirSync(directory, { recursive: true });
  await new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(runtime.node, [runtime.npm, 'install', '--prefix', directory, '--no-audit', '--no-fund', '--no-package-lock', `github:${REPOSITORY}#${release.sha}`], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
    child.stdout.resume();
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Update download timed out. Try Check for updates again.')); }, 240000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Could not install the update. ${errors.trim()}`));
    });
  });
  const appPath = validateRuntime(directory, release);
  // Recent Electron packages download lazily. Run their installer in Node, never
  // require the lazy downloader inside the running Electron main process.
  const electronRoot = path.join(directory, 'node_modules', 'electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await exec(runtime.node, [path.join(electronRoot, 'install.js')], { env, windowsHide: true, timeout: 240000, maxBuffer: 1024 * 1024 });
  const executable = fs.readFileSync(path.join(electronRoot, 'path.txt'), 'utf8').trim();
  const binary = path.resolve(electronRoot, 'dist', executable);
  if (!isInside(path.join(electronRoot, 'dist'), binary) || !fs.statSync(binary).isFile()) throw new Error('The update is missing its Electron runtime.');
  writeJSON(path.join(directory, 'installed.json'), release);
  return { ...release, directory: directoryName, appPath, node: runtime.node };
}

module.exports = { findNodeAndNpm, prepareUpdate };
