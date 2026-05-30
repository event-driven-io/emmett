import { execa, type ResultPromise } from 'execa';
import { prefixOutput } from './output';

export type TsxOptions = {
  command: string;
  args: string[];
  label: string;
  // Inspector port used when bringing up with `debug`. Bound to 127.0.0.1 and unique
  // per resource so several debuggable processes don't collide on 9229.
  inspectPort?: number;
};

// Spawns a long-running process (here: `npm start`) and stops it on `down`. Output
// is piped with the resource label as a prefix; with `debug` the child waits for a
// debugger on its inspect port (--inspect-brk) so an IDE can attach before any code runs.
export const tsx = (options: TsxOptions) => {
  let proc: ResultPromise | undefined;

  const up = (opts?: { debug?: boolean }): void => {
    const inspect = opts?.debug
      ? {
          NODE_OPTIONS: `--inspect-brk=127.0.0.1:${options.inspectPort ?? 9229}`,
        }
      : {};
    proc = execa(options.command, options.args, {
      env: { ...process.env, ...inspect },
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
