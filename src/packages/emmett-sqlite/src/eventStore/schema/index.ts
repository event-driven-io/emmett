import {
  runSQLMigrations,
  schemaComponent,
  type Dumbo,
  type MigrationDryRun,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type {
  AnySQLiteEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  transactionToSQLiteProjectionHandlerContext,
  type SQLiteProjectionHandlerContext,
} from '../projections';
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
  dryRun?: MigrationDryRun | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
  migrationTimeoutMS?: number | undefined;
} & EventStoreDatabaseSchemaOptions;

export const eventStoreSchemaComponent = (
  options?: EventStoreDatabaseSchemaOptions,
) =>
  schemaComponent('emt:eventStore', {
    migrations: () => eventStoreSchemaMigrationsFor(options),
  });

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions;
};

export const createEventStoreSchema = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>({
  hooks,
  schema: options,
  ...session
}: {
  pool: Dumbo;
  driver?: Driver;
  connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  hooks?: SQLiteEventStoreOptions['hooks'];
  schema?: CreateEventStoreSchemaOptions;
}): Promise<RunSQLMigrationsResult> => {
  const { pool } = session;
  const databaseSchema = eventStoreDatabaseSchema(options);

  if (options?.dryRun === 'diff')
    return runSQLMigrations(pool, eventStoreSchemaMigrationsFor(options), {
      ...options,
      migrationTable: databaseSchema.migrationTable,
    });

  return pool.withTransaction<RunSQLMigrationsResult>(async (tx) => {
    const schemaContext: SQLiteProjectionHandlerContext<Driver> = {
      ...transactionToSQLiteProjectionHandlerContext(session, tx),
      migrationOptions: {
        ...options,
        ...databaseSchema,
      },
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
};
