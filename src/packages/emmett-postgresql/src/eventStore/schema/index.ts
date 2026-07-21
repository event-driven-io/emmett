import type { SQL } from '@event-driven-io/dumbo';
import {
  dumbo,
  runSQLMigrations,
  sqlMigration,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { PgPool, PgTransaction } from '@event-driven-io/dumbo/pg';
import type { JSONSerializationOptions } from '@event-driven-io/emmett';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import { transactionToPostgreSQLProjectionHandlerContext } from '../projections';
import { appendToStreamSQL } from './appendToStream';
import { eventStoreSchemaMigrations } from './migrations';
import {
  releaseProcessorLockSQL,
  tryAcquireProcessorLockSQL,
} from './processors';
import {
  activateProjectionSQL,
  deactivateProjectionSQL,
  registerProjectionSQL,
} from './projections';
import { storeSubscriptionCheckpointSQL } from './storeProcessorCheckpoint';
import {
  addDefaultPartitionSQL,
  addPartitionSQL,
  addTablePartitions,
  messagesTableSQL,
  processorsTableSQL,
  projectionsTableSQL,
  sanitizeNameSQL,
  streamsTableSQL,
} from './tables';

export * from './appendToStream';
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

export const schemaSQL: SQL[] = [
  streamsTableSQL,
  messagesTableSQL,
  projectionsTableSQL,
  processorsTableSQL,
  sanitizeNameSQL,
  addTablePartitions,
  addPartitionSQL,
  appendToStreamSQL,
  addDefaultPartitionSQL,
  storeSubscriptionCheckpointSQL,
  tryAcquireProcessorLockSQL,
  releaseProcessorLockSQL,
  registerProjectionSQL,
  activateProjectionSQL,
  deactivateProjectionSQL,
];

export const schemaMigration = sqlMigration(
  'emt:postgresql:eventstore:initial',
  schemaSQL,
);

export type CreateEventStoreSchemaOptions = {
  dryRun?: boolean | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
  migrationTimeoutMs?: number | undefined;
} & JSONSerializationOptions;

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

      const result = await runSQLMigrations(
        nestedPool,
        eventStoreSchemaMigrations,
        options,
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
