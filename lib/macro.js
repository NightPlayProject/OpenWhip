const { setTimeout: delay } = require('node:timers/promises');
const { DEFAULTS } = require('./options');

const PHRASES = Object.freeze(['FASTER', 'GO FASTER', 'Faster CLANKER', 'Work FASTER', 'Speed it up clanker']);

class MacroRunner {
  constructor(input, options = {}, sleep = delay) {
    this.input = input;
    this.options = { ...DEFAULTS, ...options };
    this.sleep = sleep;
    this.busy = false;
  }

  async run(target) {
    if (this.busy) return { sent: false, reason: 'busy' };
    if (!target) throw new Error('Focus the app you want to whip first.');
    this.busy = true;
    const text = this.options.message || PHRASES[Math.floor(Math.random() * PHRASES.length)];
    const assertActive = async () => {
      if (!await this.input.isActive(target)) throw new Error('Active app changed; remaining keys cancelled.');
    };
    try {
      await assertActive();
      await this.input.waitForRelease(target);
      await assertActive();
      await this.input.interrupt(target);
      await this.sleep(this.options.interruptDelay);
      await assertActive();
      await this.input.type(target, text);
      await this.sleep(this.options.enterDelay);
      await this.input.waitForRelease(target);
      await assertActive();
      await this.input.enter(target);
      return { sent: true };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { MacroRunner, PHRASES };
