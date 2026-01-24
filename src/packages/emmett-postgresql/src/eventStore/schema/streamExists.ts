import { sql, type SQLExecutor } from '@event-driven-io/dumbo';
import type { StreamExistsResult } from '@event-driven-io/emmett';
import { defaultTag, streamsTable } from './typing';

type StreamExistsSqlResult = { exists: boolean };

export type PostgresStreamExistsOptions = { partition: string };

export const streamExists = async (
  execute: SQLExecutor,
  streamId: string,
  options?: PostgresStreamExistsOptions,
): Promise<StreamExistsResult> => {
  const queryResult = await execute.query<StreamExistsSqlResult>(
    sql(
      `SELECT EXISTS (
        SELECT 1
        from ${streamsTable.name}
        WHERE stream_id = %L AND partition = %L AND is_archived = FALSE)
      `,
      streamId,
      options?.partition ?? defaultTag,
    ),
  );

  return queryResult.rows[0]?.exists ?? false;
};
