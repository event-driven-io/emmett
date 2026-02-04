import { exists, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { StreamExistsResult } from '@event-driven-io/emmett';
import { defaultTag, streamsTable } from './typing';

export type SQLiteStreamExistsOptions = { partition: string };

type StreamExistsSqlResult = { exists: boolean };

export const streamExists = (
  execute: SQLExecutor,
  streamId: string,
  options?: SQLiteStreamExistsOptions,
): Promise<StreamExistsResult> =>
  exists(
    execute.query<StreamExistsSqlResult>(
      SQL`SELECT EXISTS (
        SELECT 1
        from ${SQL.identifier(streamsTable.name)}
        WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE) as exists
      `,
    ),
  );
