import {
  JSONParser,
  type BigIntStreamPosition,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { type SQLiteConnection } from '../../connection';
import { SQLiteEventStoreDefaultStreamVersion } from '../SQLiteEventStore';
import { defaultTag, messagesTable } from './typing';

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
  db: SQLiteConnection,
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
  const fromCondition: string = options?.from
    ? `AND stream_position >= ${options.from}`
    : '';

  const to = Number(
    options?.to ??
      (options?.maxCount ? (options.from ?? 0n) + options.maxCount : NaN),
  );

  const toCondition = !isNaN(to) ? `AND stream_position <= ${to}` : '';

  const upcast =
    options?.schema?.versioning?.upcast ??
    ((event: EventPayloadType) => event as unknown as EventType);

  const results = await db.query<ReadStreamSqlResult>(
    `SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${messagesTable.name}
           WHERE stream_id = ? AND partition = ? AND is_archived = FALSE ${fromCondition} ${toCondition}
           ORDER BY stream_position ASC`,
    [streamId, options?.partition ?? defaultTag],
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

      return upcast(event) as ReadEvent<
        EventType,
        ReadEventMetadataWithGlobalPosition
      >;
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
