import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const [packageManager, projectDir, ...packageNames] = process.argv.slice(2);
const packagesDir = resolve(projectDir, 'packages');

const run = (command: string, args: string[], cwd = '.') => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
  }
};

rmSync(packagesDir, { recursive: true, force: true });
mkdirSync(packagesDir, { recursive: true });

run('npm', [
  'pack',
  '--pack-destination',
  packagesDir,
  ...packageNames.flatMap((name) => ['-w', `@event-driven-io/${name}`]),
]);

const tarballs = readdirSync(packagesDir).map((file) => `./packages/${file}`);

if (packageManager === 'bun') {
  run('bun', ['install'], projectDir);
  run('bun', ['add', '--no-save', ...tarballs], projectDir);
} else {
  run('npm', ['ci'], projectDir);
  run('npm', ['install', '--no-save', ...tarballs], projectDir);
}
