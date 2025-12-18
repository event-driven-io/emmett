import {
  type NodePostgresClient,
  type NodePostgresPool,
  type SQL,
} from '@event-driven-io/dumbo';
import type { PostgresEventStoreOptions } from '../postgreSQLEventStore';
import type { PostgreSQLProjectionHandlerContext } from '../projections';
import {
  appendToStreamSQL,
  dropOldAppendToSQLWithoutGlobalPositions,
} from './appendToStream';
import { storeSubscriptionCheckpointSQL } from './storeProcessorCheckpoint';
import {
  addDefaultPartitionSQL,
  addPartitionSQL,
  addTablePartitions,
  dropFutureConceptModuleAndTenantFunctions,
  messagesTableSQL,
  migrationFromEventsToMessagesSQL,
  migrationFromSubscriptionsToProcessorsSQL,
  processorsTableSQL,
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
  migrationFromEventsToMessagesSQL,
  migrationFromSubscriptionsToProcessorsSQL,
  streamsTableSQL,
  messagesTableSQL,
  processorsTableSQL,
  sanitizeNameSQL,
  addTablePartitions,
  addPartitionSQL,
  dropFutureConceptModuleAndTenantFunctions,
  //addModuleSQL,
  //addTenantSQL,
  //addModuleForAllTenantsSQL,
  //addTenantForAllModulesSQL,
  dropOldAppendToSQLWithoutGlobalPositions,
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
