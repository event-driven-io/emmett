import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type { JSONSerializer } from '@event-driven-io/emmett';
import {
  bigIntProcessorCheckpoint,
  upcastRecordedMessage,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { SQLiteEventStoreDefaultStreamVersion } from '../SQLiteEventStore';
import {
  defaultTag,
  messagesTable,
  streamsTable,
  tableReference,
} from './typing';

type ReadStreamSqlResult = {
  stream_position: string;
  message_data: string;
  message_metadata: string;
  message_schema_version: string;
  message_type: string;
  message_id: string;
  global_position: string;
  created: string;
};

export const readStream = async <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  execute: SQLExecutor,
  streamId: string,
  options: ReadStreamOptions<EventType, EventPayloadType> & {
    partition?: string;
    databaseSchemaName?: string;
    serializer: JSONSerializer;
  },
): Promise<
  ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
> => {
  const { serializer } = options;
  const fromCondition: SQL = options.from
    ? SQL`AND stream_position >= ${options.from}`
    : SQL.EMPTY;

  const toCondition: SQL =
    options.to !== undefined
      ? SQL`AND stream_position <= ${options.to}`
      : SQL.EMPTY;

  const limit: SQL =
    options.maxCount !== undefined ? SQL`LIMIT ${options.maxCount}` : SQL.EMPTY;

  const { rows: results } = await execute.query<ReadStreamSqlResult>(
    SQL`SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
        FROM ${tableReference(options?.databaseSchemaName, messagesTable.name)}
        WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${fromCondition} ${toCondition}
        ORDER BY stream_position ASC
        ${limit}`,
  );

  const messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    results.map((row) => {
      const rawEvent = {
        type: row.message_type,
        data: serializer.deserialize(row.message_data),
        metadata: serializer.deserialize(row.message_metadata),
      } as unknown as EventPayloadType;

      const metadata: ReadEventMetadataWithGlobalPosition = {
        ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition: bigIntProcessorCheckpoint(BigInt(row.global_position)),
        checkpoint: bigIntProcessorCheckpoint(BigInt(row.global_position)),
      };

      const event = {
        ...rawEvent,
        kind: 'Event',
        metadata: metadata as CombinedReadEventMetadata<
          EventPayloadType,
          ReadEventMetadataWithGlobalPosition
        >,
      };

      return upcastRecordedMessage(event, options?.schema?.versioning);
    });

  const isRange =
    options.from !== undefined ||
    options.to !== undefined ||
    options.maxCount !== undefined;

  // A range may not include the last message, so read the version from the stream
  if (isRange) {
    const { rows } = await execute.query<{ stream_position: string }>(
      SQL`SELECT stream_position
          FROM ${tableReference(options?.databaseSchemaName, streamsTable.name)}
          WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE`,
    );
    const stream = rows[0];

    return stream
      ? {
          currentStreamVersion: BigInt(stream.stream_position),
          events: messages,
          streamExists: true,
        }
      : {
          currentStreamVersion: SQLiteEventStoreDefaultStreamVersion,
          events: [],
          streamExists: false,
        };
  }

  return messages.length > 0
    ? {
        currentStreamVersion:
          messages[messages.length - 1]!.metadata.streamPosition,
        events: messages,
        streamExists: true,
      }
    : {
        currentStreamVersion: SQLiteEventStoreDefaultStreamVersion,
        events: [],
        streamExists: false,
      };
};
