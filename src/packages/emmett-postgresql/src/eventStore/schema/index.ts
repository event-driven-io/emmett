import {
  dumbo,
  runSQLMigrations,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { PgPool, PgTransaction } from '@event-driven-io/dumbo/pg';
import type { JSONSerializationOptions } from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import { transactionToPostgreSQLProjectionHandlerContext } from '../projections';
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

export const createEventStoreSchema = (
  connectionString: string,
  pool: PgPool,
  hooks?: PostgresEventStoreOptions['hooks'],
  options?: CreateEventStoreSchemaOptions,
): Promise<RunSQLMigrationsResult> => {
  return pool.withTransaction(async (tx: PgTransaction) => {
    const context = await transactionToPostgreSQLProjectionHandlerContext(
      connectionString,
      pool,
      tx,
    );
    const nestedPool = dumbo({
      connectionString,
      connection: tx.connection,
      serialization: options?.serialization,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    try {
      if (hooks?.onBeforeSchemaCreated) {
        await hooks.onBeforeSchemaCreated(context);
      }

      const databaseSchema = eventStoreDatabaseSchema(options);
      const result = await runSQLMigrations(
        nestedPool,
        eventStoreSchemaMigrationsFor(options),
        {
          ...options,
          migrationTable: databaseSchema.migrationTable,
        },
      );

      if (hooks?.onAfterSchemaCreated) {
        await hooks.onAfterSchemaCreated(context);
      }
      return result;
    } finally {
      await nestedPool.close();
    }
  });
};
