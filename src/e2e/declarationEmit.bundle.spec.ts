import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type ResolutionScenario = {
  name: string;
  packageType: 'commonjs' | 'module';
  module: string;
  moduleResolution: string;
};

const resolutionScenarios: ResolutionScenario[] = [
  {
    name: 'CommonJS with nodenext resolution',
    packageType: 'commonjs',
    module: 'nodenext',
    moduleResolution: 'nodenext',
  },
  {
    name: 'ESM with nodenext resolution',
    packageType: 'module',
    module: 'nodenext',
    moduleResolution: 'nodenext',
  },
  {
    name: 'ESM with bundler resolution',
    packageType: 'module',
    module: 'esnext',
    moduleResolution: 'bundler',
  },
];

describe.each(resolutionScenarios)('consumer in $name', (scenario) => {
  it('emits declarations for exported projections without type annotations', () => {
    // Given
    const consumer = `
      import { SQL } from '@event-driven-io/dumbo';
      import {
        pongoSingleStreamProjection as postgreSQLPongoSingleStreamProjection,
        postgreSQLRawSQLProjection,
      } from '@event-driven-io/emmett-postgresql';
      import {
        pongoSingleStreamProjection as sqlitePongoSingleStreamProjection,
        sqliteRawSQLProjection,
      } from '@event-driven-io/emmett-sqlite';

      type Counted = { type: 'Counted'; data: { count: number } };
      type Counter = { count: number };

      export const postgreSQLCounter = postgreSQLRawSQLProjection<Counted>({
        name: 'counter',
        canHandle: ['Counted'],
        evolve: () => SQL\`SELECT 1\`,
      });

      export const postgreSQLPongoCounter = postgreSQLPongoSingleStreamProjection<Counter, Counted>({
        collectionName: 'counters',
        canHandle: ['Counted'],
        evolve: (document: Counter, { data }: Counted) => ({ count: document.count + data.count }),
        initialState: () => ({ count: 0 }),
      });

      export const sqliteCounter = sqliteRawSQLProjection<Counted>({
        name: 'counter',
        canHandle: ['Counted'],
        evolve: () => SQL\`SELECT 1\`,
      });

      export const sqlitePongoCounter = sqlitePongoSingleStreamProjection<Counter, Counted>({
        collectionName: 'counters',
        canHandle: ['Counted'],
        evolve: (document: Counter, { data }: Counted) => ({ count: document.count + data.count }),
        initialState: () => ({ count: 0 }),
      });
    `;

    // When
    const result = compileConsumer(scenario, consumer);

    // Then
    expect(result.stdout, result.stdout).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects projections for another database or driver in the event store', () => {
    // Given
    const consumer = `
      import { SQL } from '@event-driven-io/dumbo';
      import { projections } from '@event-driven-io/emmett';
      import {
        getPostgreSQLEventStore,
        postgreSQLRawSQLProjection,
      } from '@event-driven-io/emmett-postgresql';
      import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
      import {
        getSQLiteEventStore,
        sqliteRawSQLProjection,
      } from '@event-driven-io/emmett-sqlite';
      import type { D1EventStoreDriver } from '@event-driven-io/emmett-sqlite/cloudflare';
      import {
        sqlite3EventStoreDriver,
        type SQLite3EventStoreDriver,
      } from '@event-driven-io/emmett-sqlite/sqlite3';

      type Counted = { type: 'Counted'; data: { count: number } };

      const definition = {
        name: 'counter',
        canHandle: ['Counted' as const],
        evolve: () => SQL\`SELECT 1\`,
      };

      const postgreSQLCounter = postgreSQLRawSQLProjection<Counted>(definition);
      const sqliteCounter = sqliteRawSQLProjection<Counted>(definition);
      const sqlite3Counter = sqliteRawSQLProjection<Counted, Counted, SQLite3EventStoreDriver>(definition);
      const d1Counter = sqliteRawSQLProjection<Counted, Counted, D1EventStoreDriver>(definition);

      const postgreSQLStore = { driver: pgEventStoreDriver, connectionString: 'postgresql://localhost' };
      const sqlite3Store = { driver: sqlite3EventStoreDriver, fileName: ':memory:' };

      getPostgreSQLEventStore({ ...postgreSQLStore, projections: projections.inline([postgreSQLCounter]) });
      // @ts-expect-error an SQLite projection does not fit a PostgreSQL event store
      getPostgreSQLEventStore({ ...postgreSQLStore, projections: projections.inline([sqliteCounter]) });

      getSQLiteEventStore({ ...sqlite3Store, projections: projections.inline([sqliteCounter]) });
      getSQLiteEventStore({ ...sqlite3Store, projections: projections.inline([sqlite3Counter]) });
      // @ts-expect-error a D1 projection does not fit an sqlite3 event store
      getSQLiteEventStore({ ...sqlite3Store, projections: projections.inline([d1Counter]) });
    `;

    // When
    const result = compileConsumer(scenario, consumer);

    // Then
    expect(result.stdout, result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});

function compileConsumer(scenario: ResolutionScenario, source: string) {
  const projectDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'emmett-declarations-'),
  );

  try {
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(projectDirectory, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(projectDirectory, 'package.json'),
      JSON.stringify({ type: scenario.packageType }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module: scenario.module,
          moduleResolution: scenario.moduleResolution,
          strict: true,
          skipLibCheck: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: 'dist',
          types: [],
        },
        files: ['consumer.ts'],
      }),
    );
    fs.writeFileSync(path.join(projectDirectory, 'consumer.ts'), source);

    return spawnSync(
      process.execPath,
      [
        path.resolve('node_modules/typescript/bin/tsc'),
        '-p',
        projectDirectory,
        '--pretty',
        'false',
      ],
      { encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(projectDirectory, { recursive: true, force: true });
  }
}
