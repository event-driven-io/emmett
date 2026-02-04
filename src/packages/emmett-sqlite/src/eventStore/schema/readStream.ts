import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  JSONParser,
  upcastRecordedMessage,
  type BigIntStreamPosition,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { SQLiteEventStoreDefaultStreamVersion } from '../SQLiteEventStore';
import { defaultTag, messagesTable } from './typing';
const { identifier } = SQL;

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
  options?: ReadStreamOptions<
    BigIntStreamPosition,
    EventType,
    EventPayloadType
  > & {
    partition?: string;
  },
): Promise<
  ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
> => {
  const fromCondition: SQL = options?.from
    ? SQL`AND stream_position >= ${options.from}`
    : SQL.EMPTY;

  const to = Number(
    options?.to ??
      (options?.maxCount ? (options.from ?? 0n) + options.maxCount : NaN),
  );

  const toCondition: SQL = !isNaN(to)
    ? SQL`AND stream_position <= ${to}`
    : SQL.EMPTY;

  const { rows: results } = await execute.query<ReadStreamSqlResult>(
    SQL`SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
        FROM ${identifier(messagesTable.name)}
        WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${fromCondition} ${toCondition}
        ORDER BY stream_position ASC`,
  );

  const messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    results.map((row) => {
      const rawEvent = {
        type: row.message_type,
        data: JSONParser.parse(row.message_data),
        metadata: JSONParser.parse(row.message_metadata),
      } as unknown as EventPayloadType;

      const metadata: ReadEventMetadataWithGlobalPosition = {
        ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition: BigInt(row.global_position),
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
