import type { SQL } from '@event-driven-io/dumbo';
import { sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { appendToStreamSQL } from '../appendToStream';
import {
  releaseProcessorLockSQL,
  tryAcquireProcessorLockSQL,
} from '../processors';
import {
  activateProjectionSQL,
  deactivateProjectionSQL,
  registerProjectionSQL,
} from '../projections';
import { storeSubscriptionCheckpointSQL } from '../storeProcessorCheckpoint';
import {
  addDefaultPartitionSQL,
  addPartitionSQL,
  addTablePartitions,
  messagesTableSQL,
  processorsTableSQL,
  projectionsTableSQL,
  sanitizeNameSQL,
  streamsTableSQL,
} from '../tables';
import { migrations_0_38_7 } from './0_38_7';
import { migrations_0_42_0 } from './0_42_0';
import { migrations_0_43_0 } from './0_43_0';

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

export const currentPostgreSQLEventStoreSchemaVersion = '0.43.0';

export const schemaMigration = sqlMigration(
  'emt:postgresql:eventstore:initial',
  schemaSQL,
);

export const pastEventStoreSchemaMigrations: SQLMigration[] = [
  ...migrations_0_38_7,
  ...migrations_0_42_0,
  ...migrations_0_43_0,
];

export const eventStoreSchemaMigrations: SQLMigration[] = [
  ...pastEventStoreSchemaMigrations,
  schemaMigration,
];
