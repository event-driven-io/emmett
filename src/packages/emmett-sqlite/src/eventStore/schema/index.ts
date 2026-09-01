import {
  runSQLMigrations,
  type Dumbo,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import { noopScope } from '@event-driven-io/emmett';
import type { SQLiteProjectionHandlerContext } from '../projections';
import type { SQLiteEventStoreOptions } from '../SQLiteEventStore';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { eventStoreSchemaMigrationsFor } from './migrations';

export * from './appendToStream';
export * from './eventStoreDatabaseSchema';
export * from './eventStoreSchemaSQL';
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
} & EventStoreDatabaseSchemaOptions;

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions;
};

export const createEventStoreSchema = (
  pool: Dumbo,
  hooks?: SQLiteEventStoreOptions['hooks'],
  options?: CreateEventStoreSchemaOptions,
): Promise<RunSQLMigrationsResult> =>
  pool.withTransaction<RunSQLMigrationsResult>(async (tx) => {
    const databaseSchema = eventStoreDatabaseSchema(options);
    const schemaContext: SQLiteProjectionHandlerContext = {
      execute: tx.execute,
      connection: tx.connection as AnySQLiteConnection,
      driverType: pool.driverType,
      migrationOptions: {
        ...options,
        ...databaseSchema,
      },
      observabilityScope: noopScope,
    };

    if (hooks?.onBeforeSchemaCreated) {
      await hooks.onBeforeSchemaCreated(schemaContext);
    }

    const result = await runSQLMigrations(
      pool,
      eventStoreSchemaMigrationsFor(options),
      {
        ...options,
        migrationTable: databaseSchema.migrationTable,
        execute: tx.execute,
      },
    );

    if (hooks?.onAfterSchemaCreated) {
      await hooks.onAfterSchemaCreated(schemaContext);
    }

    return options?.dryRun ? { success: false, result } : result;
  });
