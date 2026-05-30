import { execa, type ResultPromise } from 'execa';

export type TsxOptions = { command: string; args: string[] };

// Spawns a long-running tsx process (here: `npm start`) and stops it on `down`.
export const tsx = (options: TsxOptions) => {
  let proc: ResultPromise | undefined;

  const up = (): void => {
    proc = execa(options.command, options.args, { stdio: 'inherit' });
    // Don't let the child keep the loop alive: tests finish, Node exits, and
    // execa's cleanup kills the process — so the runner exits without an explicit
    // teardown while the containers stay warm.
    proc.unref();
  };

  const down = async (): Promise<void> => {
    if (!proc) return;
    proc.kill('SIGTERM');
    await proc.catch(() => {});
    proc = undefined;
  };

  return { up, down };
};
