// A single named verification. `verify` runs it; throws on assertion failure.
export type Verification = { name: string; verify: () => Promise<void> };

// Callable namespace: verify() runs all; verify.<key>() runs one. Keys stay typed.
export type Verify<T extends Record<string, Verification>> =
  (() => Promise<void>) & {
    [K in keyof T]: () => Promise<void>;
  };

// Lifecycle flags. Settable on the stack() config (defaults) and overridable per call.
// Resolution precedence: explicit method option > stack config > env var > built-in default.
export type LifecycleOptions = {
  clean?: boolean; // down() before up()                    — env CLEANUP
  cleanAfter?: boolean; // down() after the run (node:test after) — env CLEANUP_AFTER
  noStart?: boolean; // skip bring-up, assume already running  — env NO_START
};

export type Renderer = 'console' | 'listr';

export type UpOptions = {
  verify?: boolean;
  renderer?: Renderer;
} & LifecycleOptions;
export type DownOptions = { keepVolumes?: boolean };

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

export type Stack = Resource;
