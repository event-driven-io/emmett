import { execa } from 'execa';
import { URLS } from '../../../stack';

export type DockerComposeOptions = { file: string; profile: string };

// Drives `docker compose` for one compose file + profile. `up` is idempotent —
// compose leaves already-running containers in place, preserving the reuse path.
export const dockerCompose = (options: DockerComposeOptions) => {
  const args = ['compose', '-f', options.file, '--profile', options.profile];

  const up = async (): Promise<void> => {
    await execa('docker', [...args, 'up', '-d'], { stdio: 'inherit' });
  };

  const down = async (opts?: { keepVolumes?: boolean }): Promise<void> => {
    await execa(
      'docker',
      [
        ...args,
        'down',
        ...(opts?.keepVolumes ? [] : ['-v']),
        '--remove-orphans',
      ],
      { stdio: 'inherit' },
    );
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

  return { up, down, service };
};

export async function diagCollector() {
  const text = await fetch(URLS.otelCollectorMetrics)
    .then((r) => r.text())
    .catch(() => 'unreachable');
  const emmett = text
    .split('\n')
    .filter((l) => l.startsWith('emmett_') && !l.startsWith('#'))
    .slice(0, 5);
  console.log(
    emmett.length
      ? `\n  collector /metrics (emmett lines):\n  ${emmett.join('\n  ')}`
      : '\n  collector /metrics: no emmett_* lines found',
  );
}
