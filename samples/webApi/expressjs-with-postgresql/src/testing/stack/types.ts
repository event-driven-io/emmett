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
  clean?: boolean; // down({ cleanup: true }) before up()    — env CLEANUP
  noStart?: boolean; // skip bring-up, assume already running  — env NO_START
};

export type Renderer = 'console' | 'listr';

// The stack's "dashboard": the endpoints + tips printed once the stack is up.
export type Dashboard = {
  title?: string;
  endpoints: Record<string, string>;
  tips?: string[];
};

// Presentation defaults configured on the stack. `renderer` picks the bring-up
// view; `showResourceOutput` toggles whether spawned-process output is piped
// through (false → only the stack's own orchestration logs + dashboard).
export type Presentation = {
  renderer?: Renderer;
  dashboard?: Dashboard;
  showResourceOutput?: boolean;
};

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

// The root Resource, plus `test` sugar: bring up, verify, then close (down) unless
// running against a stack we didn't start (noStart).
export type Stack = Resource & {
  test(opts?: UpOptions & DownOptions): Promise<void>;
};
