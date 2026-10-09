const DEFAULTS = Object.freeze({ interruptDelay: 500, enterDelay: 150 });

function parseOptions(args) {
  const options = { ...DEFAULTS, command: 'start' };
  const commands = new Map([['--help', 'help'], ['-h', 'help'], ['--version', 'version'], ['-v', 'version'], ['--status', 'status'], ['--quit', 'quit']]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (commands.has(arg)) {
      if (options.command !== 'start') throw new Error('Choose one command at a time.');
      options.command = commands.get(arg);
    } else if (arg === '--message') {
      const value = args[++i];
      if (!value || value.length > 500 || /[\r\n\x00-\x1f\x7f]/.test(value)) {
        throw new Error('--message must be a single line of 1–500 printable characters.');
      }
      options.message = value;
    } else if (arg === '--interrupt-delay' || arg === '--enter-delay') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) > 10000) {
        throw new Error(`${arg} requires a number from 0 to 10000 milliseconds.`);
      }
      options[arg === '--interrupt-delay' ? 'interruptDelay' : 'enterDelay'] = Number(value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

module.exports = { DEFAULTS, parseOptions };
