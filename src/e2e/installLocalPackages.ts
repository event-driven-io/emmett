import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [packageManager, projectDir, ...packageNames] = process.argv.slice(2);

if (!['npm', 'bun'].includes(packageManager ?? '') || !projectDir || packageNames.length === 0) {
  throw new Error('Usage: node e2e/installLocalPackages.ts <npm|bun> <fixture> <package names...>');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'emmett-compat-'));
const consumerDirectory = join(temporaryDirectory, 'consumer');
const packagesDirectory = join(temporaryDirectory, 'packages');

const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
  }
};

try {
  mkdirSync(packagesDirectory);
  cpSync(resolve(root, projectDir), consumerDirectory, {
    recursive: true,
    filter: (source) => !['node_modules', 'packages', 'dist', '.vite', '.nuxt', '.output'].includes(basename(source)),
  });
  run('npm', [
    'pack', '--quiet', '--pack-destination', packagesDirectory,
    ...packageNames.flatMap((name) => ['-w', `@event-driven-io/${name}`]),
  ], root);
  const tarballs = readdirSync(packagesDirectory).map((file) => join(packagesDirectory, file));
  if (tarballs.length !== packageNames.length) {
    throw new Error('Not all requested workspace packages were packed');
  }
  if (packageManager === 'bun') {
    const tarballFor = (name: string) => {
      const tarball = tarballs.find((file) => basename(file).replace(/-\d.*$/, '') === `event-driven-io-${name}`);
      if (!tarball) throw new Error(`Tarball for ${name} was not packed`);
      return tarball;
    };
    const packageJsonPath = join(consumerDirectory, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    packageJson.overrides = Object.fromEntries(
      packageNames.map((name) => [`@event-driven-io/${name}`, `file:${tarballFor(name)}`]),
    );
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    run('bun', ['install'], consumerDirectory);
    run('bun', ['run', 'index.ts'], consumerDirectory);
  } else {
    run('npm', ['ci'], consumerDirectory);
    run('npm', ['uninstall', ...packageNames.map((name) => `@event-driven-io/${name}`)], consumerDirectory);
    run('npm', ['install', '--no-save', ...tarballs], consumerDirectory);
    run('npm', ['test'], consumerDirectory);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
