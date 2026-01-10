import { rawSql, type SQLExecutor } from '@event-driven-io/dumbo';
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
    rawSql(
      `TRUNCATE TABLE ${streamsTable.name}, ${messagesTable.name}, ${processorsTable.name}, ${projectionsTable.name} CASCADE${options?.resetSequences ? '; ALTER SEQUENCE emt_global_message_position RESTART WITH 1' : ''};`,
    ),
  );
};
