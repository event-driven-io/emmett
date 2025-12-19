import {
  type NodePostgresClient,
  type NodePostgresPool,
  type SQL,
} from '@event-driven-io/dumbo';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import type { PostgreSQLProjectionHandlerContext } from '../projections';
import { appendToStreamSQL } from './appendToStream';
import { migration_0_38_7_and_older } from './migrations/0_38_7';
import { migration_0_42_0_FromSubscriptionsToProcessorsSQL } from './migrations/0_42_0';
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
export * from './readLastMessageGlobalPosition';
export * from './readMessagesBatch';
export * from './readProcessorCheckpoint';
export * from './readStream';
export * from './storeProcessorCheckpoint';
export * from './tables';
export * from './typing';

export const schemaSQL: SQL[] = [
  ...migration_0_38_7_and_older,
  migration_0_42_0_FromSubscriptionsToProcessorsSQL,
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
];

export const createEventStoreSchema = async (
  connectionString: string,
  pool: NodePostgresPool,
  hooks?: PostgresEventStoreOptions['hooks'],
): Promise<void> => {
  await pool.withTransaction(async (tx) => {
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

    if (hooks?.onBeforeSchemaCreated) {
      await hooks.onBeforeSchemaCreated(context);
    }
    await context.execute.batchCommand(schemaSQL);
  });

  if (hooks?.onAfterSchemaCreated) {
    await hooks.onAfterSchemaCreated();
  }
};
