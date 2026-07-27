import { execa, type ResultPromise } from 'execa';
import { prefixOutput } from './output';

export type SpawnProcessOptions = {
  command: string;
  args: string[];
  label: string;
};

// Spawns a long-running process and stops it on `down`. Output is piped with the
// resource label as a prefix. `up` takes optional extra env (e.g. NODE_OPTIONS) so
// callers stay in charge of runtime-specific flags.
export const spawnProcess = (options: SpawnProcessOptions) => {
  let proc: ResultPromise | undefined;

  const up = (opts?: { env?: Record<string, string> }): void => {
    proc = execa(options.command, options.args, {
      env: { ...process.env, ...opts?.env },
    });
    prefixOutput(proc, options.label);
  };

  const down = async (): Promise<void> => {
    if (!proc) return;
    proc.kill('SIGTERM');
    await proc.catch(() => {});
    proc = undefined;
  };

  return { up, down };
};
