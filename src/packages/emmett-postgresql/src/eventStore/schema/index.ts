import { type NodePostgresPool, type SQL } from '@event-driven-io/dumbo';
import { appendEventsSQL } from './appendToStream';
import { storeSubscriptionCheckpointSQL } from './storeSubscriptionCheckpoint';
import {
  addDefaultPartitionSQL,
  addModuleForAllTenantsSQL,
  addModuleSQL,
  addPartitionSQL,
  addTablePartitions,
  addTenantForAllModulesSQL,
  addTenantSQL,
  messagesTableSQL,
  migrationFromEventsToMessagesSQL,
  sanitizeNameSQL,
  streamsTableSQL,
  subscriptionsTableSQL,
} from './tables';

export * from './appendToStream';
export * from './readLastMessageGlobalPosition';
export * from './readMessagesBatch';
export * from './readStream';
export * from './readSubscriptionCheckpoint';
export * from './storeSubscriptionCheckpoint';
export * from './tables';
export * from './typing';

export const schemaSQL: SQL[] = [
  migrationFromEventsToMessagesSQL,
  streamsTableSQL,
  messagesTableSQL,
  subscriptionsTableSQL,
  sanitizeNameSQL,
  addTablePartitions,
  addPartitionSQL,
  addModuleSQL,
  addTenantSQL,
  addModuleForAllTenantsSQL,
  addTenantForAllModulesSQL,
  appendEventsSQL,
  addDefaultPartitionSQL,
  storeSubscriptionCheckpointSQL,
];

export const createEventStoreSchema = async (
  pool: NodePostgresPool,
): Promise<void> => {
  await pool.withTransaction(({ execute }) => execute.batchCommand(schemaSQL));
};
