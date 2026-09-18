import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

type ModuleFormat = 'cjs' | 'js';
type PackageName = 'almanac' | 'emmett';

const moduleFormats: ModuleFormat[] = ['cjs', 'js'];

const moduleSpecifierPatterns: Record<ModuleFormat, RegExp> = {
  cjs: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  js: /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g,
};

describe.each(bundleBoundaryScenarios())(
  '$packageName/$entry bundle',
  ({ packageName, entry, forbiddenDependency, forbiddenSource }) => {
    const distDirectory = path.resolve(`packages/${packageName}/dist`);

    it.each(moduleFormats)(
      'does not import Node.js built-ins in its %s graph',
      (format) => {
        // Given
        const files = reachableFiles(distDirectory, entry, format);

        // When
        const builtInImports = files.flatMap((file) =>
          externalImports(distDirectory, file, format)
            .filter(isNodeBuiltIn)
            .map((dependency) => `${file}: ${dependency}`),
        );

        // Then
        expect(
          builtInImports,
          `${packageName}/${entry}.${format} imports a Node.js built-in`,
        ).toEqual([]);
      },
    );

    it.each(moduleFormats)(
      'does not import dependencies of other entries in its %s graph',
      (format) => {
        // Given
        const files = reachableFiles(distDirectory, entry, format);

        // When
        const unexpectedImports = files.flatMap((file) =>
          externalImports(distDirectory, file, format)
            .filter((dependency) => forbiddenDependency.test(dependency))
            .map((dependency) => `${file}: ${dependency}`),
        );

        // Then
        expect(
          unexpectedImports,
          `${packageName}/${entry}.${format} imports a dependency from another entry`,
        ).toEqual([]);
      },
    );

    it.each(moduleFormats)(
      'does not include sources of other entries in its %s graph',
      (format) => {
        // Given
        const files = reachableFiles(distDirectory, entry, format);

        // When
        const unexpectedSources = files.flatMap((file) =>
          bundledPackageSources(packageName, distDirectory, file)
            .filter((source) => forbiddenSource.test(source))
            .map((source) => `${file}: ${source}`),
        );

        // Then
        expect(
          unexpectedSources,
          `${packageName}/${entry}.${format} crosses a source boundary`,
        ).toEqual([]);
      },
    );
  },
);

describe('runtime-agnostic entries', () => {
  it.each(runtimeScenarios())(
    'do not generate random values or UUIDs while importing $packageName in $moduleSystem',
    ({ packageName, format }) => {
      // Given
      const consumer = randomValuesConsumer(packageName, format);

      // When
      const result = runNodeConsumer(format, consumer);

      // Then
      expect(result.status, result.stderr).toBe(0);
    },
  );
});

function bundleBoundaryScenarios() {
  const almanac = {
    forbiddenDependency: /^(?:pino|@opentelemetry\/)/,
    forbiddenSource:
      /^(?:providers\/(?:otel|pino)\/|otel(?:-node)?\.ts$|pino\.ts$)/,
  };

  return [
    { packageName: 'almanac' as const, entry: 'index', ...almanac },
    { packageName: 'almanac' as const, entry: 'console', ...almanac },
    {
      packageName: 'emmett' as const,
      entry: 'index',
      forbiddenDependency:
        /^(?:commander|@opentelemetry\/|@event-driven-io\/almanac\/(?:otel|otel-node|pino)$)/,
      forbiddenSource: /^(?:commandLine\/|cli\.ts$|otel(?:-node)?\.ts$)/,
    },
  ];
}

function runtimeScenarios() {
  return (['almanac', 'emmett'] as const).flatMap((packageName) =>
    moduleFormats.map((format) => ({
      packageName,
      format,
      moduleSystem: format === 'js' ? 'ESM' : 'CommonJS',
    })),
  );
}

function reachableFiles(
  distDirectory: string,
  entry: string,
  format: ModuleFormat,
): string[] {
  const pending = [`${entry}.${format}`];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;

    visited.add(file);
    pending.push(
      ...moduleSpecifiers(distDirectory, file, format)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) =>
          path.posix.join(path.posix.dirname(file), specifier),
        ),
    );
  }

  return [...visited];
}

function externalImports(
  distDirectory: string,
  file: string,
  format: ModuleFormat,
): string[] {
  return moduleSpecifiers(distDirectory, file, format).filter(
    (specifier) => !specifier.startsWith('.'),
  );
}

function moduleSpecifiers(
  distDirectory: string,
  file: string,
  format: ModuleFormat,
): string[] {
  const source = fs.readFileSync(path.join(distDirectory, file), 'utf8');

  return [...source.matchAll(moduleSpecifierPatterns[format])].map(
    (match) => match[1]!,
  );
}

function isNodeBuiltIn(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(specifier);
}

function bundledPackageSources(
  packageName: PackageName,
  distDirectory: string,
  file: string,
): string[] {
  const sourceMapFile = path.join(distDirectory, `${file}.map`);
  if (!fs.existsSync(sourceMapFile)) return [];

  const sourceMap = JSON.parse(fs.readFileSync(sourceMapFile, 'utf8')) as {
    sources: string[];
  };
  const packageSourceRoot = path.resolve(`packages/${packageName}/src`);

  return sourceMap.sources.flatMap((source) => {
    const packageSource = path.relative(
      packageSourceRoot,
      path.resolve(path.dirname(sourceMapFile), source),
    );

    return packageSource.startsWith('..') || path.isAbsolute(packageSource)
      ? []
      : [packageSource.replaceAll(path.sep, '/')];
  });
}

function randomValuesConsumer(
  packageName: PackageName,
  format: ModuleFormat,
): string {
  const entry = path.resolve(`packages/${packageName}/dist/index.${format}`);
  const load =
    format === 'js'
      ? `await import(${JSON.stringify(pathToFileURL(entry).href)});`
      : `require(${JSON.stringify(entry)});`;

  return `
    const run = async () => {
      let calls = 0;
      const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      const randomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
      globalThis.crypto.getRandomValues = (array) => {
        calls++;
        return getRandomValues(array);
      };
      globalThis.crypto.randomUUID = () => {
        calls++;
        return randomUUID();
      };

      ${load}

      if (calls > 0) {
        throw new Error(\`Importing ${packageName} called crypto.getRandomValues or crypto.randomUUID \${calls} time(s)\`);
      }
    };

    run().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
}

function runNodeConsumer(format: ModuleFormat, source: string) {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'emmett-runtime-'),
  );
  const consumerFile = path.join(
    tempDirectory,
    `consumer.${format === 'js' ? 'mjs' : 'cjs'}`,
  );

  try {
    fs.writeFileSync(consumerFile, source);
    return spawnSync(process.execPath, [consumerFile], { encoding: 'utf8' });
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}
