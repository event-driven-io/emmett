import {
  dumbo,
  runPostgreSQLMigrations,
  sqlMigration,
  type NodePostgresClient,
  type NodePostgresPool,
  type RunSQLMigrationsResult,
  type SQL,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import { type PostgreSQLProjectionHandlerContext } from '../projections';
import { appendToStreamSQL } from './appendToStream';
import { migration_0_38_7_and_older } from './migrations/0_38_7';
import {
  migration_0_42_0_2_AddProcessorProjectionFunctions,
  migration_0_42_0_FromSubscriptionsToProcessors,
} from './migrations/0_42_0';
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
export * from './typing';

export * from './appendToStream';
export * from './migrations';
export * from './processors';
export * from './projections';
export * from './readLastMessageGlobalPosition';
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

export const eventStoreSchemaMigrations: SQLMigration[] = [
  migration_0_38_7_and_older,
  migration_0_42_0_FromSubscriptionsToProcessors,
  migration_0_42_0_2_AddProcessorProjectionFunctions,
  schemaMigration,
];

export type CreateEventStoreSchemaOptions = {
  dryRun?: boolean | undefined;
  ignoreMigrationHashMismatch?: boolean | undefined;
};

export type EventStoreSchemaMigrationOptions = {
  migrationOptions?: CreateEventStoreSchemaOptions;
};

export const createEventStoreSchema = (
  connectionString: string,
  pool: NodePostgresPool,
  hooks?: PostgresEventStoreOptions['hooks'],
  options?: CreateEventStoreSchemaOptions,
): Promise<RunSQLMigrationsResult> => {
  return pool.withTransaction(async (tx) => {
    const client = (await tx.connection.open()) as NodePostgresClient;
    const context: PostgreSQLProjectionHandlerContext = {
      execute: tx.execute,
      connection: {
        connectionString,
        client,
        transaction: tx,
        pool,
      },
    };
    const nestedPool = dumbo({ connectionString, connection: tx.connection });

    try {
      if (hooks?.onBeforeSchemaCreated) {
        await hooks.onBeforeSchemaCreated(context);
      }

      const result = await runPostgreSQLMigrations(
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
