import { after } from 'node:test';
import { sequence } from './composition';
import { listrUp } from './reporter';
import type {
  DownOptions,
  LifecycleOptions,
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
} & LifecycleOptions;

// The root Resource. Composes its resources as a sequence, layers the stack's own
// cross-resource verifications on top, and honours the lifecycle flags (clean,
// noStart, cleanAfter) resolved by precedence at bring-up.
export const stack = (config: StackConfig): Stack => {
  const root = sequence(...config.resources);

  const runVerify = async (): Promise<void> => {
    if (config.verify) await config.verify();
    await root.verify();
  };

  const up = async (opts?: UpOptions): Promise<void> => {
    const clean = resolve('clean', 'CLEANUP', opts, config);
    const noStart = resolve('noStart', 'NO_START', opts, config);
    const cleanAfter = resolve('cleanAfter', 'CLEANUP_AFTER', opts, config);

    if (noStart) {
      console.log(
        '▶ no-start: skipping bring-up, assuming the stack is running',
      );
    } else {
      if (clean) {
        console.log('▶ clean: tearing down the stack first (down -v)…');
        await root.down();
      }
      if (opts?.renderer === 'listr') await listrUp(root);
      else await root.up({ verify: false });
    }

    if (cleanAfter) after(() => down());

    if (opts?.verify !== false) await runVerify();
  };

  const down = async (opts?: DownOptions): Promise<void> => {
    await root.down(opts);
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
