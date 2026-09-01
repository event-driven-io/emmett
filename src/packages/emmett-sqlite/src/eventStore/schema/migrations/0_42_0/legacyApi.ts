import { SQL, singleOrNull, type SQLExecutor } from '@event-driven-io/dumbo';
import type { Event } from '@event-driven-io/emmett';
import { defaultTag, messagesTable, streamsTable } from '../../typing';

const { identifier, merge } = SQL;

export const appendToStream = async <E extends Event>(
  execute: SQLExecutor,
  options: {
    streamId: string;
    streamType: string;
    events: E[];
    partition?: string;
  },
): Promise<{ nextStreamPosition: bigint; globalPositions: bigint[] }> => {
  const currentStreamPosition = await readStreamPosition(
    execute,
    options.streamId,
  );

  const streamPartition = options.partition ?? streamsTable.columns.partition;

  const streamSQL =
    currentStreamPosition === 0n
      ? SQL`INSERT INTO ${identifier(streamsTable.name)}
              (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES (${options.streamId}, ${options.events.length}, ${streamPartition}, ${options.streamType}, '[]', false)
            RETURNING stream_position`
      : SQL`UPDATE ${identifier(streamsTable.name)}
            SET stream_position = stream_position + ${options.events.length}
            WHERE stream_id = ${options.streamId}
              AND stream_position = ${currentStreamPosition}
              AND partition = ${streamPartition}
              AND is_archived = false
            RETURNING stream_position`;

  const values = options.events.map(
    (event, index) =>
      SQL`(${options.streamId},${currentStreamPosition + BigInt(index + 1)},${options.partition ?? defaultTag},'E',${event.data},${{}},${currentStreamPosition},${event.type},${crypto.randomUUID()},${false})`,
  );

  const messagesSQL = SQL`
    INSERT INTO ${identifier(messagesTable.name)} (
      stream_id, stream_position, partition, message_kind, message_data,
      message_metadata, message_schema_version, message_type, message_id, is_archived
    )
    VALUES ${merge(values, ',')}
    RETURNING CAST(global_position as VARCHAR) AS global_position`;

  const [streamResult, messagesResult] = await execute.batchCommand<{
    stream_position?: string;
    global_position?: string;
  }>([streamSQL, messagesSQL], { assertChanges: true });

  return {
    nextStreamPosition: BigInt(streamResult!.rows[0]!.stream_position!),
    globalPositions: messagesResult!.rows.map((row) =>
      BigInt(row.global_position!),
    ),
  };
};

const readStreamPosition = async (
  execute: SQLExecutor,
  streamId: string,
): Promise<bigint> => {
  const row = await singleOrNull(
    execute.query<{ stream_position: string }>(
      SQL`SELECT CAST(stream_position AS VARCHAR) AS stream_position
          FROM ${identifier(streamsTable.name)}
          WHERE stream_id = ${streamId}`,
    ),
  );

  return row?.stream_position != null ? BigInt(row.stream_position) : 0n;
};
