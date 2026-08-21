import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  emmettRelation,
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
} from './typing';

const globalMessagePositionSequence = 'emt_global_message_position';

export const truncateTables = async (
  execute: SQLExecutor,
  options?: { resetSequences?: boolean; databaseSchemaName?: string },
): Promise<void> => {
  await execute.command(
    SQL`TRUNCATE TABLE 
        ${emmettRelation(options?.databaseSchemaName, streamsTable.name)}, 
        ${emmettRelation(options?.databaseSchemaName, messagesTable.name)}, 
        ${emmettRelation(options?.databaseSchemaName, processorsTable.name)}, 
        ${emmettRelation(options?.databaseSchemaName, projectionsTable.name)} 
        CASCADE;`,
  );

  if (options?.resetSequences === true) {
    await execute.command(
      SQL`ALTER SEQUENCE ${emmettRelation(options.databaseSchemaName, globalMessagePositionSequence)} RESTART WITH 1;`,
    );
  }
};
