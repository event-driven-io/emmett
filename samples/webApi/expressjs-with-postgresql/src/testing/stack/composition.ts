import type { DownOptions, Resource, UpOptions } from './types';
import { aggregate } from './verify';

// Brings children up — `sequence` in order, `parallel` concurrently — then gates on
// its own (no-op) healthCheck. Children are always brought up with skipVerification;
// only the outermost up() call runs verify(), once, over the whole tree.
const composite = (
  mode: 'sequence' | 'parallel',
  resources: Resource[],
): Resource => {
  const bringUp = async (opts: UpOptions): Promise<void> => {
    const childOpts = { ...opts, skipVerification: true };
    if (mode === 'parallel') {
      await Promise.all(resources.map((child) => child.up(childOpts)));
    } else {
      for (const child of resources) await child.up(childOpts);
    }
  };

  const up = async (opts?: UpOptions): Promise<void> => {
    await bringUp({ ...opts });
    if (!opts?.skipVerification) await verify();
  };

  const down = async (opts?: DownOptions): Promise<void> => {
    for (const resource of [...resources].reverse()) await resource.down(opts);
  };

  const verify = aggregate(...resources.map((r) => r.verify));

  return {
    name: mode,
    up,
    down,
    restart: async (opts?: UpOptions) => {
      await down();
      await up(opts);
    },
    healthCheck: async () => {},
    verify,
    children: resources,
    mode,
  };
};

export const sequence = (...resources: Resource[]): Resource =>
  composite('sequence', resources);

export const parallel = (...resources: Resource[]): Resource =>
  composite('parallel', resources);
