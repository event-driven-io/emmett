// Aspire-like entry point. One command brings the whole observability stack up and
// keeps it running; the stack owns the renderer, dashboard, signal handling and
// debugger detection, so this stays a thin command line over `observability`.
//
//   npm run dev                 # bring the stack up, print the dashboard, stay warm
//   npm run dev -- --clean      # tear down (incl. volumes) first, then bring up
//   npm run dev -- --no-start   # attach to an already-running stack
//   npm run dev -- --debug      # start the app with the inspector attached
//   npm run dev -- --quiet      # only orchestration logs + dashboard, no app output
//   npm run dev:clean           # tear the stack down (incl. volumes)

import { observability } from './stack';

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const command = argv.find((arg) => !arg.startsWith('-')) ?? 'up';

if (command === 'down' || command === 'clean') {
  await observability.down({ cleanup: true });
  process.exit(0);
}

await observability.up({
  skipVerification: true,
  ...(flag('--clean') ? { clean: true } : {}),
  ...(flag('--no-start') ? { noStart: true } : {}),
  ...(flag('--debug') ? { debug: true } : {}),
  ...(flag('--quiet') ? { showResourceOutput: false } : {}),
});
