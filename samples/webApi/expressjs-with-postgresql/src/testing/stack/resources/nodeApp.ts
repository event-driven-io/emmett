import { execa } from 'execa';
import { tsx } from '../tools/tsx';
import type { DownOptions, Resource, UpOptions } from '../types';
import { verifications } from '../verify';

export type NodeAppOptions = {
  name: string;
  command: string;
  args: string[];
  url: string;
  label: string;
  inspectPort?: number;
  // Readiness probe; resolves when the process is up, throws on timeout.
  healthCheck: () => Promise<void>;
  // "Is the thing already running and ours?" — lets a warm process be reused.
  isOurs: () => Promise<boolean>;
};

// A generic node process resource: owns the spawned process lifecycle and gates
// bring-up on a supplied readiness probe. It knows nothing about HTTP — a web API
// layers that on via nodeWebApi; a worker could supply a different readiness probe.
export const nodeApp = (opts: NodeAppOptions) => {
  const proc = tsx({
    command: opts.command,
    args: opts.args,
    label: opts.label,
    inspectPort: opts.inspectPort,
  });
  let started = false;

  const up = async (upOpts?: UpOptions): Promise<void> => {
    if (await opts.isOurs()) {
      console.log('▶ app already running and healthy — skipping start');
      return;
    }

    const portTaken = await fetch(opts.url)
      .then(() => true)
      .catch(() => false);
    if (portTaken) {
      // Port is occupied but not by our app — stale process or unrelated service.
      console.error(
        `\n  ✗ ${opts.url} is occupied by a process that is not this app.\n` +
          '  It may be a stale version of this app (connected to a wiped database)\n' +
          '  or a completely different service.\n' +
          '  Fix: run  npm run verify:observability:cleanup  to kill it and restart,\n' +
          '  or free the port manually.\n',
      );
      process.exit(1);
    }

    console.log('▶ starting app…');
    proc.up({ debug: upOpts?.debug });
    started = true;
    await opts.healthCheck();
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
    name: opts.name,
    up,
    down,
    restart: async (restartOpts?: UpOptions) => {
      await down();
      await up(restartOpts);
    },
    healthCheck: opts.healthCheck,
    verify: verifications({}),
  } satisfies Resource;
};
