import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
  tableReference,
} from './typing';

const globalMessagePositionSequence = 'emt_global_message_position';

export const truncateTables = async (
  execute: SQLExecutor,
  options?: { resetSequences?: boolean; databaseSchemaName?: string },
): Promise<void> => {
  await execute.command(
    SQL`TRUNCATE TABLE 
        ${tableReference(options?.databaseSchemaName, streamsTable.name)}, 
        ${tableReference(options?.databaseSchemaName, messagesTable.name)}, 
        ${tableReference(options?.databaseSchemaName, processorsTable.name)}, 
        ${tableReference(options?.databaseSchemaName, projectionsTable.name)} 
        CASCADE;`,
  );

  if (options?.resetSequences === true) {
    await execute.command(
      SQL`ALTER SEQUENCE ${tableReference(options.databaseSchemaName, globalMessagePositionSequence)} RESTART WITH 1;`,
    );
  }
};
