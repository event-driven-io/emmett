import { execa } from 'execa';
import { checkUrl } from '../../index';
import { httpHealthCheck } from '../healthCheck';
import { tsx } from '../tools/tsx';
import type { DownOptions, Resource, UpOptions } from '../types';
import { verifications } from '../verify';

export type NodeAppOptions = {
  url: string;
  service: string;
  inspectPort?: number;
};

// The application under test. Starts via `npm start` unless the app is already
// running and reports the expected service name on /health — which is also how a
// stray process on the same port is detected (it fails the service-name check).
export const nodeApp = (opts: NodeAppOptions) => {
  const proc = tsx({
    command: 'npm',
    args: ['start'],
    label: opts.service,
    inspectPort: opts.inspectPort,
  });
  let started = false;

  // /health returns { status: 'ok', service: 'expressjs-with-postgresql' } —
  // checking the service name distinguishes our app from other processes on the port.
  const validate = async (res: Response): Promise<boolean> => {
    const json = (await res.json().catch(() => ({}))) as { service?: string };
    if (json.service !== opts.service) {
      console.log(
        `    app /health: service="${json.service ?? '(missing)'}", expected="${opts.service}"`,
      );
      return false;
    }
    return true;
  };

  const isOurs = () => checkUrl('app /health', `${opts.url}/health`, validate);

  const healthCheck = httpHealthCheck('app /health', `${opts.url}/health`, {
    validate,
    timeout: 60_000,
  });

  const endpoint = (path = ''): string =>
    path ? `${opts.url}/${path}` : opts.url;

  const up = async (upOpts?: UpOptions): Promise<void> => {
    if (await isOurs()) {
      console.log('▶ app already running and healthy — skipping npm start');
      return;
    }

    const portTaken = await fetch(opts.url)
      .then(() => true)
      .catch(() => false);
    if (portTaken) {
      // Port is occupied but not by our app — stale process or unrelated service.
      console.error(
        '\n  ✗ Port 3000 is occupied by a process that is not this app.\n' +
          '  It may be a stale version of this app (connected to a wiped database)\n' +
          '  or a completely different service.\n' +
          '  Fix: run  npm run verify:observability:cleanup  to kill it and restart,\n' +
          '  or manually free port 3000.\n',
      );
      process.exit(1);
    }

    console.log('▶ starting app…');
    proc.up({ debug: upOpts?.debug });
    started = true;
    await healthCheck();
  };

  const down = async (downOpts?: DownOptions): Promise<void> => {
    if (started) {
      console.log('\n▶ stopping app…');
      await proc.down();
      console.log('▶ app stopped');
      started = false;
    }
    // On cleanup, free the port even if we didn't start the process — a clean
    // bring-up tears down first, and a stale app (connected to a wiped DB) would
    // otherwise hold the port and trip the foreign-process guard on the next up().
    if (downOpts?.cleanup) {
      const portUrl = new URL(opts.url);
      await execa('bash', [
        '-c',
        `fuser -k ${portUrl.port}/tcp 2>/dev/null || true`,
      ]).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  return {
    name: 'app',
    up,
    down,
    restart: async (opts?: UpOptions) => {
      await down();
      await up(opts);
    },
    healthCheck,
    verify: verifications({}),
    endpoint,
  } satisfies Resource & { endpoint: typeof endpoint };
};
