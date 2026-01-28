import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  messagesTable,
  processorsTable,
  projectionsTable,
  streamsTable,
} from './typing';

export const truncateTables = async (
  execute: SQLExecutor,
  options?: { resetSequences?: boolean },
): Promise<void> => {
  await execute.command(
    SQL`TRUNCATE TABLE 
        ${SQL.identifier(streamsTable.name)}, 
        ${SQL.identifier(messagesTable.name)}, 
        ${SQL.identifier(processorsTable.name)}, 
        ${SQL.identifier(projectionsTable.name)} 
        CASCADE${SQL.plain(options?.resetSequences ? '; ALTER SEQUENCE emt_global_message_position RESTART WITH 1' : '')};`,
  );
};
