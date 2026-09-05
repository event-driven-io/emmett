import {
  assertEqual,
  assertFalse,
  assertOk,
  assertTrue,
} from '@event-driven-io/emmett';
import { Linter } from 'eslint';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it } from 'vitest';

type RestrictedSyntaxOption = {
  selector: string;
  message: string;
};

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

const dumboDriverFiles = [
  'packages/emmett-postgresql/**',
  'packages/emmett-sqlite/**',
];

const expectedSelector =
  "CallExpression[callee.name='dumbo'] > ObjectExpression" +
  ":not(:has(> Property[key.name='driver']))" +
  ':not(:has(> SpreadElement))';

const dumboPgImportFiles = ['packages/emmett-postgresql/**'];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const loadEslintConfigEntries = async (): Promise<EslintConfigEntry[]> => {
  const config = (await import(
    pathToFileURL(path.join(repoRoot, 'eslint.config.mjs')).href
  )) as { default: unknown };

  return config.default as EslintConfigEntry[];
};

const noRestrictedSyntaxOptionsFor = async (
  files: ReadonlyArray<string>,
): Promise<ReadonlyArray<RestrictedSyntaxOption>> => {
  const eslintConfigEntries = await loadEslintConfigEntries();
  const config = eslintConfigEntries.find(
    (entry) =>
      Array.isArray(entry.files) &&
      entry.files.length === files.length &&
      entry.files.every((file, index) => file === files[index]),
  );
  assertOk(config, `Expected ESLint config for ${files.join(', ')}`);

  const rule = config.rules?.['no-restricted-syntax'];
  assertTrue(Array.isArray(rule), 'Expected no-restricted-syntax rule');
  assertEqual((rule as unknown[])[0], 'error');

  return (rule as unknown[]).slice(1) as RestrictedSyntaxOption[];
};

const lintWithRestrictedSyntax = (
  code: string,
  options: ReadonlyArray<RestrictedSyntaxOption>,
) => {
  const linter = new Linter();

  return linter.verify(code, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-restricted-syntax': ['error', ...options],
    },
  });
};

const isDumboDriverViolation = (message: {
  ruleId: string | null;
  message: string;
}): boolean =>
  message.ruleId === 'no-restricted-syntax' &&
  message.message.includes('dumbo() must receive an explicit `driver`');

void describe('Emmett ESLint dumbo driver restrictions', () => {
  void it('configures the rule for the PostgreSQL and SQLite packages', async () => {
    const options = await noRestrictedSyntaxOptionsFor(dumboDriverFiles);

    assertTrue(
      options.some(({ selector }) => selector === expectedSelector),
      `Expected selector "${expectedSelector}". Got: ${JSON.stringify(options)}`,
    );
  });

  void it('rejects a dumbo call without an explicit driver', async () => {
    const options = await noRestrictedSyntaxOptionsFor(dumboDriverFiles);

    const messages = lintWithRestrictedSyntax(
      `export const pool = dumbo({ connectionString: 'x' });\n`,
      options,
    );

    assertTrue(
      messages.some(isDumboDriverViolation),
      `Expected a dumbo driver violation. Got: ${JSON.stringify(messages)}`,
    );
  });

  void it('accepts a dumbo call with an explicit driver', async () => {
    const options = await noRestrictedSyntaxOptionsFor(dumboDriverFiles);

    const messages = lintWithRestrictedSyntax(
      `export const pool = dumbo({ driver: pgDumboDriver, connectionString: 'x' });\n`,
      options,
    );

    assertFalse(
      messages.some(isDumboDriverViolation),
      `Expected no dumbo driver violation. Got: ${JSON.stringify(messages)}`,
    );
  });

  void it('accepts a dumbo call spreading driver options', async () => {
    const options = await noRestrictedSyntaxOptionsFor(dumboDriverFiles);

    const messages = lintWithRestrictedSyntax(
      `export const pool = dumbo({ ...options.driver.mapToDumboOptions(options) });\n`,
      options,
    );

    assertFalse(
      messages.some(isDumboDriverViolation),
      `Expected no dumbo driver violation. Got: ${JSON.stringify(messages)}`,
    );
  });
});

const restrictedImportPathsFor = async (
  files: ReadonlyArray<string>,
): Promise<{
  paths: ReadonlyArray<RestrictedImportPath>;
  ignores: ReadonlyArray<string>;
}> => {
  const eslintConfigEntries = await loadEslintConfigEntries();
  const config = eslintConfigEntries.find(
    (entry) =>
      Array.isArray(entry.files) &&
      entry.files.length === files.length &&
      entry.files.every((file, index) => file === files[index]) &&
      entry.rules?.['@typescript-eslint/no-restricted-imports'] !== undefined,
  );
  assertOk(config, `Expected ESLint config for ${files.join(', ')}`);

  const rule = config.rules?.['@typescript-eslint/no-restricted-imports'];
  assertTrue(
    Array.isArray(rule),
    'Expected @typescript-eslint/no-restricted-imports rule',
  );
  assertEqual((rule as unknown[])[0], 'error');

  return {
    paths: ((rule as unknown[])[1] as { paths: RestrictedImportPath[] }).paths,
    ignores: config.ignores ?? [],
  };
};

const lintWithRestrictedImports = (
  code: string,
  paths: ReadonlyArray<RestrictedImportPath>,
) => {
  const linter = new Linter();

  return linter.verify(code, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: paths.map(({ name, message }) => ({ name, message })) },
      ],
    },
  });
};

void describe('Emmett ESLint dumbo/pg import restrictions', () => {
  void it('restricts the pg driver module for the PostgreSQL package', async () => {
    const { paths } = await restrictedImportPathsFor(dumboPgImportFiles);

    const restricted = paths.find(
      ({ name }) => name === '@event-driven-io/dumbo/pg',
    );

    assertOk(
      restricted,
      `Expected '@event-driven-io/dumbo/pg' to be restricted. Got: ${JSON.stringify(paths)}`,
    );
    assertTrue(
      restricted.allowTypeImports === true,
      'Expected type-only imports of the pg driver module to stay allowed',
    );
  });

  void it('exempts the driver seam, the testing helpers and the specs', async () => {
    const { ignores } = await restrictedImportPathsFor(dumboPgImportFiles);

    for (const exempt of [
      'packages/emmett-postgresql/**/*.spec.ts',
      'packages/emmett-postgresql/src/pg.ts',
      'packages/emmett-postgresql/src/testing/**',
    ])
      assertTrue(
        ignores.includes(exempt),
        `Expected '${exempt}' to be exempt. Got: ${JSON.stringify(ignores)}`,
      );
  });

  void it('rejects a value import of the pg driver module', async () => {
    const { paths } = await restrictedImportPathsFor(dumboPgImportFiles);

    const messages = lintWithRestrictedImports(
      `import { pgDumboDriver } from '@event-driven-io/dumbo/pg';\n`,
      paths,
    );

    assertTrue(
      messages.some(({ ruleId }) => ruleId === 'no-restricted-imports'),
      `Expected a restricted import violation. Got: ${JSON.stringify(messages)}`,
    );
  });
});
