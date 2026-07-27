import { aggregate } from './verify';

// Lifecycle flags. Settable on the stack() config (defaults) and overridable per call.
// Resolution precedence: explicit method option > stack config > env var > built-in default.
export type LifecycleOptions = {
  clean?: boolean; // down({ cleanup: true }) before up()    — env CLEANUP
  noStart?: boolean; // skip bring-up, assume already running  — env NO_START
};

export type Renderer = 'console' | 'listr';

export type UpOptions = {
  skipVerification?: boolean; // bring up only; don't run verify()
  debug?: boolean; // start debuggable resources with the inspector attached
  renderer?: Renderer; // overrides the stack's configured renderer
  showResourceOutput?: boolean; // overrides the stack's configured output visibility
} & LifecycleOptions;

// `cleanup` tells each resource whether this is a cleanup teardown (wipe its
// persistent state) or a routine stop. Each resource decides what that means —
// the stack never reasons about containers or volumes itself.
export type DownOptions = { cleanup?: boolean };

// The single recursive type. Leaf, group, and stack all satisfy it. Composites
// expose `children` + `mode` so a renderer can mirror the tree without re-running it.
export type Resource = {
  name: string;
  up(opts?: UpOptions): Promise<void>;
  down(opts?: DownOptions): Promise<void>;
  restart(opts?: UpOptions): Promise<void>;
  healthCheck(): Promise<void>;
  verify: () => Promise<void>;
  children?: Resource[];
  mode?: 'sequence' | 'parallel';
};

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
