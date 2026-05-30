import inspector from 'node:inspector';
import { after } from 'node:test';
import { sequence } from './composition';
import { renderDashboard } from './dashboard';
import { listrUp } from './reporter';
import { configureResourceOutput } from './tools/output';
import type {
  DownOptions,
  LifecycleOptions,
  Presentation,
  Resource,
  Stack,
  UpOptions,
} from './types';

const envFlag = (name: string): boolean | undefined => {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === '1' || v === 'true';
};

// Resolution precedence: explicit method option > stack config > env var > default.
const resolve = (
  flag: keyof LifecycleOptions,
  env: string,
  opts: LifecycleOptions | undefined,
  config: LifecycleOptions,
): boolean => opts?.[flag] ?? config[flag] ?? envFlag(env) ?? false;

export type StackConfig = {
  name: string;
  resources: Resource[];
  verify?: () => Promise<void>;
} & LifecycleOptions &
  Presentation;

// The root Resource. Composes its resources as a sequence, layers the stack's own
// cross-resource verifications on top, and owns the whole lifecycle: the clean /
// noStart / cleanAfter flags (resolved by precedence), the post-run teardown, and
// graceful shutdown on SIGINT/SIGTERM — so entry points never wire signals themselves.
export const stack = (config: StackConfig): Stack => {
  const root = sequence(...config.resources);

  const runVerify = async (): Promise<void> => {
    if (config.verify) await config.verify();
    await root.verify();
  };

  const down = async (opts?: DownOptions): Promise<void> => {
    await root.down(opts);
  };

  let signalsBound = false;
  const bindSignals = (): void => {
    if (signalsBound) return;
    signalsBound = true;
    const shutdown = (signal: NodeJS.Signals): void => {
      void (async () => {
        console.log(`\n▶ ${signal} — shutting the stack down…`);
        await down();
        process.exit(0);
      })();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  };

  const up = async (opts?: UpOptions): Promise<void> => {
    const clean = resolve('clean', 'CLEANUP', opts, config);
    const noStart = resolve('noStart', 'NO_START', opts, config);
    const cleanAfter = resolve('cleanAfter', 'CLEANUP_AFTER', opts, config);
    const renderer = opts?.renderer ?? config.renderer ?? 'console';
    const debug = opts?.debug ?? inspector.url() !== undefined;

    configureResourceOutput(
      opts?.showResourceOutput ?? config.showResourceOutput ?? true,
    );
    bindSignals();

    if (noStart) {
      console.log(
        '▶ no-start: skipping bring-up, assuming the stack is running',
      );
    } else {
      if (clean) {
        console.log('▶ clean: tearing the stack down first…');
        await down({ cleanup: true });
      }
      const bringUp = { skipVerification: true, debug };
      if (renderer === 'listr') await listrUp(root, bringUp);
      else await root.up(bringUp);

      // Tear down once the run completes — but only what we brought up, so a
      // verify run against an already-running stack (noStart) leaves it untouched.
      if (!opts?.skipVerification) after(() => down({ cleanup: cleanAfter }));
    }

    if (config.dashboard) renderDashboard(config.dashboard);

    if (!opts?.skipVerification) await runVerify();
  };

  return {
    name: config.name,
    up,
    down,
    restart: async (opts?: UpOptions) => {
      await down();
      await up(opts);
    },
    healthCheck: () => root.healthCheck(),
    verify: runVerify,
    children: root.children,
    mode: root.mode,
  };
};
