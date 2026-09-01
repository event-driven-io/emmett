import {
  runSQLMigrations,
  type Dumbo,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import type { SQLiteEventStoreOptions } from '../SQLiteEventStore';
import { eventStoreSchemaMigrations } from './migrations';

export * from './appendToStream';
export * from './migrations';
export * from './readLastMessageGlobalPosition';
export * from './readMessagesBatch';
export * from './readProcessorCheckpoint';
export * from './readStream';
export * from './storeProcessorCheckpoint';
export * from './streamExists';
export * from './tables';
export * from './typing';

export type CreateEventStoreSchemaOptions = {
  dryRun?: boolean | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
  migrationTimeoutMs?: number | undefined;
};

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions;
};

export const createEventStoreSchema = (
  pool: Dumbo,
  hooks?: SQLiteEventStoreOptions['hooks'],
  options?: CreateEventStoreSchemaOptions,
): Promise<RunSQLMigrationsResult> =>
  pool.withTransaction<RunSQLMigrationsResult>(async (tx) => {
    if (hooks?.onBeforeSchemaCreated) {
      await hooks.onBeforeSchemaCreated({
        connection: tx.connection as AnySQLiteConnection,
      });
    }

    const result = await runSQLMigrations(pool, eventStoreSchemaMigrations, {
      ...options,
      execute: tx.execute,
    });

    if (hooks?.onAfterSchemaCreated) {
      await hooks.onAfterSchemaCreated();
    }

    return options?.dryRun ? { success: false, result } : result;
  });
