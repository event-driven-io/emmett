import type { SQL } from '@event-driven-io/dumbo';
import type { EventStoreDatabaseSchemaOptions } from './eventStoreDatabaseSchema';
import {
  messagesTableSQLFor,
  processorsTableSQLFor,
  projectionsTableSQLFor,
  streamsTableSQLFor,
} from './tables';

export const eventStoreSchemaSQL = (
  options?: EventStoreDatabaseSchemaOptions,
): SQL[] => {
  const databaseSchemaName = options?.databaseSchemaName;

  return [
    streamsTableSQLFor(databaseSchemaName),
    messagesTableSQLFor(databaseSchemaName),
    processorsTableSQLFor(databaseSchemaName),
    projectionsTableSQLFor(databaseSchemaName),
  ];
};

export const schemaSQL: SQL[] = eventStoreSchemaSQL();
