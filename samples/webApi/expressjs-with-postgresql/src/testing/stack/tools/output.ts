import type { ResultPromise } from 'execa';

// Whether spawned-process output is piped through. The stack flips this from its
// `showResourceOutput` config so "just orchestration logs + dashboard" is possible.
let showResourceOutput = true;
export const configureResourceOutput = (show: boolean): void => {
  showResourceOutput = show;
};

// Pipes a spawned process's stdout/stderr to ours, prefixing every line with the
// resource label so interleaved output from concurrent processes stays readable.
export const prefixOutput = (proc: ResultPromise, label: string): void => {
  if (!showResourceOutput) return;
  const tag = `[${label}]`;
  const write = (target: NodeJS.WriteStream, data: Buffer): void => {
    for (const line of data.toString().split('\n')) {
      if (line.length > 0) target.write(`${tag} ${line}\n`);
    }
  };
  proc.stdout?.on('data', (d: Buffer) => write(process.stdout, d));
  proc.stderr?.on('data', (d: Buffer) => write(process.stderr, d));
};
