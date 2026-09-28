import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  decodeStreamNameCursor,
  encodeStreamNameCursor,
  ValidationError,
  type ListStreamsOptions,
  type ListStreamsResult,
} from '@event-driven-io/emmett';
import { defaultTag, streamsTable, tableReference } from './typing';

type ListStreamsSqlResult = {
  stream_id: string;
  stream_position: string;
};

/**
 * Lists active streams ordered by `stream_id` (SQLite binary collation).
 * `q` matches a case-sensitive substring of the name, and `streamType`
 * matches the `stream_type` column stored on append.
 */
export const listStreams = async (
  execute: SQLExecutor,
  { limit, cursor, q, streamType }: ListStreamsOptions,
  options?: { partition?: string; databaseSchemaName?: string },
): Promise<ListStreamsResult> => {
  const after =
    cursor !== undefined ? decodeStreamNameCursor(cursor) : undefined;

  if (cursor !== undefined && after === undefined)
    throw new ValidationError('Invalid cursor');

  const afterCondition =
    after !== undefined ? SQL`AND stream_id > ${after}` : SQL.EMPTY;
  const searchCondition =
    q !== undefined ? SQL`AND instr(stream_id, ${q}) > 0` : SQL.EMPTY;
  const streamTypeCondition =
    streamType !== undefined ? SQL`AND stream_type = ${streamType}` : SQL.EMPTY;

  const { rows } = await execute.query<ListStreamsSqlResult>(
    SQL`SELECT stream_id, stream_position
        FROM ${tableReference(options?.databaseSchemaName, streamsTable.name)}
        WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${afterCondition} ${searchCondition} ${streamTypeCondition}
        ORDER BY stream_id ASC
        LIMIT ${limit + 1}`,
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    streams: page.map((row) => ({
      streamName: row.stream_id,
      currentStreamVersion: BigInt(row.stream_position),
    })),
    ...(rows.length > limit && last !== undefined
      ? { nextCursor: encodeStreamNameCursor(last.stream_id) }
      : {}),
  };
};
