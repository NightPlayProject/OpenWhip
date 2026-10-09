const path = require('node:path');
const { compareVersions, readJSON, writeJSON } = require('./runtime');
const { checkGitHub } = require('./update-feed');
const { prepareUpdate } = require('./update-install');
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

class Updater {
  constructor({ profile, version, supported, enabled, onStatus, onReady, feed = checkGitHub, prepare = release => prepareUpdate(profile, release), now = Date.now }) {
    Object.assign(this, { profile, version, supported, enabled, onStatus, onReady, feed, prepare, now });
    this.file = path.join(profile, 'updates', 'check.json');
    this.busy = false;
    this.pending = null;
    this.status = { phase: supported ? 'idle' : 'development', enabled, version, busy: false };
  }
  publish(values) {
    this.status = { ...this.status, ...values, enabled: this.enabled, busy: this.busy };
    this.onStatus(this.status);
  }
  setEnabled(value) { this.enabled = value; this.publish({}); }
  async check(force = false) {
    if (!this.supported || this.busy || (!this.enabled && !force)) return;
    if (this.pending) { this.publish({ phase: 'ready', latest: this.pending.version }); return; }
    const cache = readJSON(this.file, {});
    if (!force && cache.checkedAt && this.now() - cache.checkedAt < CHECK_INTERVAL) return;
    this.busy = true;
    this.publish({ phase: 'checking', error: null });
    try {
      const release = await this.feed();
      const record = { ...cache, checkedAt: this.now(), latest: release.version, sha: release.sha };
      writeJSON(this.file, record);
      if (compareVersions(release.version, this.version) <= 0) {
        this.publish({ phase: 'current', latest: release.version });
        return;
      }
      if (!force && cache.failedSha === release.sha) throw new Error('The previous update could not start. Your previous version was restored.');
      this.publish({ phase: 'downloading', latest: release.version });
      this.pending = await this.prepare(release);
      this.publish({ phase: 'ready' });
      this.onReady(this.pending);
    } catch (error) {
      // Do not cache unsuccessful downloads for six hours.
      writeJSON(this.file, { ...readJSON(this.file, {}), checkedAt: 0 });
      this.publish({ phase: 'error', error: error.message });
    } finally { this.busy = false; this.publish({}); }
  }
}

module.exports = { Updater, CHECK_INTERVAL };
