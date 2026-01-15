import type { StreamExistsResult } from '@event-driven-io/emmett/src';
import type { SQLiteConnection } from '../../connection';
import { defaultTag, streamsTable } from './typing';

export type SQLiteStreamExistsOptions = { partition: string };

type StreamExistsSqlResult = { exists: boolean };

export const streamExists = async (
  db: SQLiteConnection,
  streamId: string,
  options?: SQLiteStreamExistsOptions,
): Promise<StreamExistsResult> => {
  const queryResult = await db.query<StreamExistsSqlResult>(
    `SELECT EXISTS (
        SELECT 1
        from ${streamsTable.name}
        WHERE stream_id = ? AND partition = ? AND is_archived = FALSE)
      `,
    [streamId, options?.partition ?? defaultTag],
  );

  return queryResult[0]?.exists ?? false;
};
