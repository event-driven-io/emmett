import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  tableReference,
} from './typing';

export const truncateTables = async (
  execute: SQLExecutor,
  options?: { databaseSchemaName?: string },
): Promise<void> => {
  for (const tableName of [
    streamsTable.name,
    messagesTable.name,
    processorsTable.name,
    projectionsTable.name,
  ]) {
    await execute.command(
      SQL`DELETE FROM ${tableReference(options?.databaseSchemaName, tableName)};`,
    );
  }
};
