import pg from 'pg';
import { executeSQLBatchInTransaction } from '../../execute';
import { type SQL } from '../../sql';
import { appendEventsSQL } from './appendEvents';
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

export * from './appendEvents';
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
