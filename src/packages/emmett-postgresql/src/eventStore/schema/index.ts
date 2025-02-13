import { type NodePostgresPool, type SQL } from '@event-driven-io/dumbo';
import { appendEventsSQL } from './appendToStream';
import { storeSubscriptionCheckpointSQL } from './storeProcessorCheckpoint';
import {
  addDefaultPartition,
  addEventsPartitions,
  addModuleForAllTenantsSQL,
  addModuleSQL,
  addTablePartitions,
  addTenantForAllModulesSQL,
  addTenantSQL,
  eventsTableSQL,
  sanitizeNameSQL,
  streamsTableSQL,
  subscriptionsTableSQL,
} from './tables';

export * from './appendToStream';
export * from './readLastMessageGlobalPosition';
export * from './readMessagesBatch';
export * from './readStream';
export * from './readProcessorCheckpoint';
export * from './storeProcessorCheckpoint';
export * from './tables';
export * from './typing';

export const schemaSQL: SQL[] = [
  streamsTableSQL,
  eventsTableSQL,
  subscriptionsTableSQL,
  sanitizeNameSQL,
  addTablePartitions,
  addEventsPartitions,
  addModuleSQL,
  addTenantSQL,
  addModuleForAllTenantsSQL,
  addTenantForAllModulesSQL,
  appendEventsSQL,
  addDefaultPartition,
  storeSubscriptionCheckpointSQL,
];

export const createEventStoreSchema = async (
  pool: NodePostgresPool,
): Promise<void> => {
  await pool.withTransaction(({ execute }) => execute.batchCommand(schemaSQL));
};
