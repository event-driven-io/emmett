import { sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { messagesTable } from './typing';

type StreamExistsSqlResult = { exists: boolean };

export const streamExists = async (
  execute: SQLExecutor,
  streamId: string,
): Promise<boolean> => {
  const queryResult = await execute.query<StreamExistsSqlResult>(
    sql(
      `SELECT EXISTS (
        SELECT 1
        from ${messagesTable.name}
        WHERE stream_id = %L AND is_archived = FALSE)
      `,
      streamId,
    ),
  );

  return queryResult.rows[0]?.exists || false;
};
