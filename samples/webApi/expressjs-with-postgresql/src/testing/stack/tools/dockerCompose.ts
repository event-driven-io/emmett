import { execa } from 'execa';
import type { DownOptions, Resource } from '../types';
import { verifications } from '../verify';
import { prefixOutput } from './output';

export type DockerComposeOptions = { file: string; profile: string };

// Drives `docker compose` for one compose file + profile as a leaf Resource. `up` is
// idempotent — compose leaves already-running containers in place, preserving the
// reuse path. A cleanup `down` removes volumes (-v); a routine `down` keeps them.
// healthCheck is a no-op; the services it starts have their own probes.
export const dockerCompose = (options: DockerComposeOptions) => {
  const args = ['compose', '-f', options.file, '--profile', options.profile];

  const run = async (extra: string[]): Promise<void> => {
    const proc = execa('docker', [...args, ...extra]);
    prefixOutput(proc, 'docker');
    await proc;
  };

  const up = async (): Promise<void> => {
    await run(['up', '-d']);
  };

  const down = async (opts?: DownOptions): Promise<void> => {
    await run(['down', ...(opts?.cleanup ? ['-v'] : []), '--remove-orphans']);
  };

  const service = (name: string) => ({
    logs: async (lines = 10): Promise<void> => {
      const { stdout } = await execa('docker', [
        ...args,
        'logs',
        '--tail',
        String(lines),
        name,
      ]).catch(() => ({ stdout: '(could not get logs)' }));
      console.log(
        `\n  docker logs ${name} (last ${lines}):\n  ${stdout.split('\n').join('\n  ')}`,
      );
    },
  });

  return {
    name: 'docker-compose',
    up,
    down,
    restart: async () => {
      await down();
      await up();
    },
    healthCheck: async () => {},
    verify: verifications({}),
    service,
  } satisfies Resource & { service: typeof service };
};
