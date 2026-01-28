import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
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
    SQL`SELECT EXISTS (
        SELECT 1
        from ${SQL.identifier(streamsTable.name)}
        WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE)
      `,
  );

  return queryResult.rows[0]?.exists ?? false;
};
