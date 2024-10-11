import { type NodePostgresPool, type SQL } from '@event-driven-io/dumbo';
import { appendEventsSQL } from './appendToStream';
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
export * from './readStream';
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
];

export const createEventStoreSchema = async (
  pool: NodePostgresPool,
): Promise<void> => {
  await pool.withTransaction(({ execute }) => execute.batchCommand(schemaSQL));
};
