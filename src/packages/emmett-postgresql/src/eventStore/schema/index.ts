import {
  runSQLMigrations,
  type Dumbo,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { JSONSerializationOptions } from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import {
  transactionToPostgreSQLProjectionHandlerContext,
  type PostgreSQLProjectionHandlerContext,
} from '../projections';
import type { PgEventStoreDriver } from '../../pg';
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
  dryRun?: boolean | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
  migrationTimeoutMs?: number | undefined;
} & JSONSerializationOptions &
  EventStoreDatabaseSchemaOptions;

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions;
};

export const createEventStoreSchema = <
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
>({
  hooks,
  schema: options,
  ...session
}: {
  pool: Dumbo;
  driver?: Driver;
  connectionOptions?: InferDumboOptionsFromEventStoreDriver<Driver>;
  hooks?: PostgresEventStoreOptions<Driver>['hooks'];
  schema?: CreateEventStoreSchemaOptions;
}): Promise<RunSQLMigrationsResult> =>
  session.pool.withTransaction<RunSQLMigrationsResult>(async (tx) => {
    const { pool } = session;
    const databaseSchema = eventStoreDatabaseSchema(options);
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

    return result;
  });
