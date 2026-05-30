import inspector from 'node:inspector';
import { sequence } from './composition';
import type {
  DownOptions,
  LifecycleOptions,
  Renderer,
  Resource,
  UpOptions,
} from './composition';
import { renderDashboard, type Dashboard } from './dashboard';
import { listrUp } from './reporter';
import { configureResourceOutput } from './tools/output';
import { onShutdown } from './tools/signals';

// Presentation defaults configured on the stack. `renderer` picks the bring-up
// view; `showResourceOutput` toggles whether spawned-process output is piped
// through (false → only the stack's own orchestration logs + dashboard).
export type Presentation = {
  renderer?: Renderer;
  dashboard?: Dashboard;
  showResourceOutput?: boolean;
};

// The root Resource, plus `test` sugar: bring up, verify, then close (down) unless
// running against a stack we didn't start (noStart).
export type Stack = Resource & {
  test(opts?: UpOptions & DownOptions): Promise<void>;
};

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
// cross-resource verifications on top, and owns the lifecycle: `up` starts everything
// and verifies but never closes; `test` is sugar that closes afterwards; the clean /
// noStart flags resolve by precedence; SIGINT/SIGTERM shut down gracefully — so entry
// points never wire signals themselves.
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

  // Starts every resource and runs verify() unless skipped — and leaves it running.
  // Closing is the caller's choice (down / test / Ctrl-C), never automatic.
  const up = async (opts?: UpOptions): Promise<void> => {
    const clean = resolve('clean', 'CLEANUP', opts, config);
    const noStart = resolve('noStart', 'NO_START', opts, config);
    const renderer = opts?.renderer ?? config.renderer ?? 'console';
    const debug = opts?.debug ?? inspector.url() !== undefined;

    configureResourceOutput(
      opts?.showResourceOutput ?? config.showResourceOutput ?? true,
    );
    if (!signalsBound) {
      signalsBound = true;
      onShutdown(down);
    }

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
    }

    if (config.dashboard) renderDashboard(config.dashboard);

    if (!opts?.skipVerification) await runVerify();
  };

  // Sugar: bring up, verify, then close — unless we're running against a stack we
  // didn't start (noStart), in which case we leave it as we found it.
  const test = async (opts?: UpOptions & DownOptions): Promise<void> => {
    await up(opts);
    if (!resolve('noStart', 'NO_START', opts, config))
      await down({
        cleanup: opts?.cleanup ?? resolve('clean', 'CLEANUP', opts, config),
      });
  };

  return {
    name: config.name,
    up,
    down,
    test,
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
