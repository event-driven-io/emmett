import type { StreamExistsResult } from '@event-driven-io/emmett/src';
import type { SQLiteConnection } from '../../connection';
import { streamsTable } from './typing';

type StreamExistsSqlResult = { exists: boolean };

export const streamExists = async (
  db: SQLiteConnection,
  streamId: string,
): Promise<StreamExistsResult> => {
  const queryResult = await db.query<StreamExistsSqlResult>(
    `SELECT EXISTS (
        SELECT 1
        from ${streamsTable.name}
        WHERE stream_id = %L AND is_archived = FALSE)
      `,
    [streamId],
  );

  return queryResult[0]?.exists ?? false;
};
