import {
  runSQLMigrations,
  schemaComponent,
  type AnySchemaComponent,
  type Dumbo,
  type MigrationDryRun,
  type MigrationStyle,
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
  components?: ReadonlyArray<AnySchemaComponent>,
) =>
  schemaComponent('emt:eventStore', {
    migrations: () => eventStoreSchemaMigrationsFor(options),
    components,
  });

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions & {
    autoMigration?: MigrationStyle | undefined;
  };
};

export const createEventStoreSchema = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>({
  hooks,
  schema: options,
  components,
  ...session
}: {
  pool: Dumbo;
  driver?: Driver;
  connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  hooks?: SQLiteEventStoreOptions['hooks'];
  schema?: CreateEventStoreSchemaOptions;
  components?: ReadonlyArray<AnySchemaComponent>;
}): Promise<RunSQLMigrationsResult> => {
  const { pool } = session;
  const databaseSchema = eventStoreDatabaseSchema(options);
  const migrations = eventStoreSchemaComponent(
    options,
    components,
  ).migrations();

  if (options?.dryRun === 'diff')
    return runSQLMigrations(pool, migrations, {
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

    const result = await runSQLMigrations(pool, migrations, {
      ...options,
      migrationTable: databaseSchema.migrationTable,
      execute: tx.execute,
    });

    if (hooks?.onAfterSchemaCreated) {
      await hooks.onAfterSchemaCreated(schemaContext);
    }

    return options?.dryRun ? { success: false, result } : result;
  });
};
