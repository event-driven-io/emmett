import {
  SQL,
  SQLCreateSchema,
  type SQL as SQLStatement,
} from '@event-driven-io/dumbo';
import { appendToStreamSQLFor } from './appendToStream';
import {
  releaseProcessorLockSQLFor,
  tryAcquireProcessorLockSQLFor,
} from './processors';
import {
  activateProjectionSQLFor,
  deactivateProjectionSQLFor,
  registerProjectionSQLFor,
} from './projections';
import { storeSubscriptionCheckpointSQLFor } from './storeProcessorCheckpoint';
import {
  addDefaultPartitionSQLFor,
  addPartitionSQLFor,
  addTablePartitionsFor,
  messagesTableSQLFor,
  processorsTableSQLFor,
  projectionsTableSQLFor,
  sanitizeNameSQLFor,
  streamsTableSQLFor,
} from './tables';
import type { EventStoreDatabaseSchemaOptions } from './eventStoreDatabaseSchema';

export const eventStoreSchemaSQL = (
  options?: EventStoreDatabaseSchemaOptions,
): SQLStatement[] => {
  const databaseSchemaName = options?.databaseSchemaName;
  const createSchemaSQL =
    databaseSchemaName === undefined
      ? []
      : [SQL`${SQLCreateSchema.from({ databaseSchemaName })}`];

  return [
    ...createSchemaSQL,
    streamsTableSQLFor(databaseSchemaName),
    messagesTableSQLFor(databaseSchemaName),
    projectionsTableSQLFor(databaseSchemaName),
    processorsTableSQLFor(databaseSchemaName),
    sanitizeNameSQLFor(databaseSchemaName),
    addTablePartitionsFor(databaseSchemaName),
    addPartitionSQLFor(databaseSchemaName),
    appendToStreamSQLFor(databaseSchemaName),
    addDefaultPartitionSQLFor(databaseSchemaName),
    storeSubscriptionCheckpointSQLFor(databaseSchemaName),
    tryAcquireProcessorLockSQLFor(databaseSchemaName),
    releaseProcessorLockSQLFor(databaseSchemaName),
    registerProjectionSQLFor(databaseSchemaName),
    activateProjectionSQLFor(databaseSchemaName),
    deactivateProjectionSQLFor(databaseSchemaName),
  ];
};

export const schemaSQL: SQLStatement[] = eventStoreSchemaSQL();
