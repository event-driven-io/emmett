import { assertEqual, assertOk, assertTrue } from '@event-driven-io/emmett';
import { Linter } from 'eslint';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'vitest';

type RestrictedImportPath = {
  name: string;
  message?: string;
  allowTypeImports?: boolean;
};

type EslintConfigEntry = {
  files?: ReadonlyArray<string>;
  ignores?: ReadonlyArray<string>;
  rules?: Record<string, unknown>;
};

const sqliteImportFiles = ['packages/emmett-sqlite/**'];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const restrictedImportsFor = async (
  files: ReadonlyArray<string>,
): Promise<{
  paths: ReadonlyArray<RestrictedImportPath>;
  ignores: ReadonlyArray<string>;
}> => {
  const config = (await import(
    pathToFileURL(path.join(repoRoot, 'eslint.config.mjs')).href
  )) as { default: unknown };

  const entry = (config.default as EslintConfigEntry[]).find(
    (candidate) =>
      Array.isArray(candidate.files) &&
      candidate.files.length === files.length &&
      candidate.files.every((file, index) => file === files[index]) &&
      candidate.rules?.['@typescript-eslint/no-restricted-imports'] !==
        undefined,
  );
  assertOk(entry, `Expected ESLint config for ${files.join(', ')}`);

  const rule = entry.rules?.['@typescript-eslint/no-restricted-imports'];
  assertTrue(
    Array.isArray(rule),
    'Expected @typescript-eslint/no-restricted-imports rule',
  );
  assertEqual((rule as unknown[])[0], 'error');

  return {
    paths: ((rule as unknown[])[1] as { paths: RestrictedImportPath[] }).paths,
    ignores: entry.ignores ?? [],
  };
};

const lintWithRestrictedImports = (
  code: string,
  paths: ReadonlyArray<RestrictedImportPath>,
) =>
  new Linter().verify(code, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: paths.map(({ name, message }) => ({ name, message })) },
      ],
    },
  });

void describe('Emmett ESLint dumbo SQLite import restrictions', () => {
  void it('restricts both SQLite driver modules', async () => {
    const { paths } = await restrictedImportsFor(sqliteImportFiles);

    for (const name of [
      '@event-driven-io/dumbo/sqlite3',
      '@event-driven-io/dumbo/cloudflare',
    ]) {
      const restricted = paths.find((candidate) => candidate.name === name);

      assertOk(
        restricted,
        `Expected '${name}' to be restricted. Got: ${JSON.stringify(paths)}`,
      );
      assertTrue(
        restricted.allowTypeImports === true,
        `Expected type-only imports of '${name}' to stay allowed`,
      );
    }
  });

  void it('exempts the driver seams, the testing helpers and the specs', async () => {
    const { ignores } = await restrictedImportsFor(sqliteImportFiles);

    for (const exempt of [
      'packages/emmett-sqlite/**/*.spec.ts',
      'packages/emmett-sqlite/src/sqlite3.ts',
      'packages/emmett-sqlite/src/cloudflare.ts',
      'packages/emmett-sqlite/src/testing/**',
    ])
      assertTrue(
        ignores.includes(exempt),
        `Expected '${exempt}' to be exempt. Got: ${JSON.stringify(ignores)}`,
      );
  });

  void it('rejects a value import of either driver module', async () => {
    const { paths } = await restrictedImportsFor(sqliteImportFiles);

    for (const code of [
      `import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';\n`,
      `import { d1DumboDriver } from '@event-driven-io/dumbo/cloudflare';\n`,
    ]) {
      const messages = lintWithRestrictedImports(code, paths);

      assertTrue(
        messages.some(({ ruleId }) => ruleId === 'no-restricted-imports'),
        `Expected a restricted import violation. Got: ${JSON.stringify(messages)}`,
      );
    }
  });
});
