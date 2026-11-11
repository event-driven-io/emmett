import {
  runSQLMigrations,
  schemaComponent,
  type AnySchemaComponent,
  type Dumbo,
  type MigrationDryRun,
  type MigrationStyle,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { JSONSerializationOptions } from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import {
  transactionToPostgreSQLProjectionHandlerContext,
  type PostgreSQLProjectionHandlerContext,
} from '../projections';
import type {
  AnyPostgreSQLEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import {
  eventStoreDatabaseSchema,
  type EventStoreDatabaseSchemaOptions,
} from './eventStoreDatabaseSchema';
import { schemaSQL } from './eventStoreSchemaSQL';
import { eventStoreSchemaMigrationsFor } from './migrations';

export * from './appendToStream';
export * from './eventStoreDatabaseSchema';
export * from './eventStoreSchemaSQL';
export * from './migrations';
export * from './processors';
export * from './projections';
export * from './readLastMessageCheckpoint';
export * from './readMessagesBatch';
export * from './readProcessorCheckpoint';
export * from './readStream';
export * from './storeProcessorCheckpoint';
export * from './streamExists';
export * from './tables';

export { schemaSQL };

export type CreateEventStoreSchemaOptions = {
  dryRun?: MigrationDryRun | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
  migrationTimeoutMS?: number | undefined;
} & JSONSerializationOptions &
  EventStoreDatabaseSchemaOptions;

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
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>({
  hooks,
  schema: options,
  components,
  ...session
}: {
  pool: Dumbo;
  driver?: Driver;
  connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  hooks?: PostgresEventStoreOptions<Driver>['hooks'];
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
    const schemaContext: PostgreSQLProjectionHandlerContext<Driver> = {
      ...transactionToPostgreSQLProjectionHandlerContext(session, tx),
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
