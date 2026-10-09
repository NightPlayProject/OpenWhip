const { PACKAGE, versionParts } = require('./runtime');
const REPOSITORY = 'NightPlayProject/OpenWhip';

async function fetchJSON(url, fetcher = fetch) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'OpenWhip-Updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > 128 * 1024) throw new Error('Update metadata is too large.');
  const text = await response.text();
  if (text.length > 128 * 1024) throw new Error('Update metadata is too large.');
  return JSON.parse(text);
}
async function checkGitHub(fetcher) {
  const commit = await fetchJSON(`https://api.github.com/repos/${REPOSITORY}/commits/main`, fetcher);
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Update server returned an invalid commit.');
  const pkg = await fetchJSON(`https://raw.githubusercontent.com/${REPOSITORY}/${commit.sha}/package.json`, fetcher);
  if (pkg.name !== PACKAGE) throw new Error('Update server returned the wrong package.');
  versionParts(pkg.version);
  return { version: pkg.version, sha: commit.sha };
}

module.exports = { REPOSITORY, fetchJSON, checkGitHub };
