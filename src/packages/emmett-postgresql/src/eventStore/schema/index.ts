import { executeSQLBatchInTransaction, type SQL } from '@event-driven-io/dumbo';
import pg from 'pg';
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

export const createEventStoreSchema = (pool: pg.Pool) =>
  executeSQLBatchInTransaction(pool, ...schemaSQL);
