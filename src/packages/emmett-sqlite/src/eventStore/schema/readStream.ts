import {
  JSONParser,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { type SQLiteConnection } from '../../sqliteConnection';
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

export const readStream = async <EventType extends Event>(
  db: SQLiteConnection,
  streamId: string,
  options?: ReadStreamOptions & { partition?: string },
): Promise<
  ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
> => {
  const fromCondition: string =
    options && 'from' in options
      ? `AND stream_position >= ${options.from}`
      : '';

  const to = Number(
    options && 'to' in options
      ? options.to
      : options && 'maxCount' in options && options.maxCount
        ? options.from + options.maxCount
        : NaN,
  );

  const toCondition = !isNaN(to) ? `AND stream_position <= ${to}` : '';

  const results = await db.query<ReadStreamSqlResult>(
    `SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${messagesTable.name}
           WHERE stream_id = ? AND partition = ? AND is_archived = FALSE ${fromCondition} ${toCondition}`,
    [streamId, options?.partition ?? defaultTag],
  );

  const messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    results.map((row) => {
      const rawEvent = {
        type: row.message_type,
        data: JSONParser.parse(row.message_data),
        metadata: JSONParser.parse(row.message_metadata),
      } as unknown as EventType;

      const metadata: ReadEventMetadataWithGlobalPosition = {
        ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition: BigInt(row.global_position),
      };

      return {
        ...rawEvent,
        kind: 'Event',
        metadata: metadata as CombinedReadEventMetadata<
          EventType,
          ReadEventMetadataWithGlobalPosition
        >,
      };
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
