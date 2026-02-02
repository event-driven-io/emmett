import { mapRows, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  type BigIntStreamPosition,
  type CombinedReadEventMetadata,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { PostgreSQLEventStoreDefaultStreamVersion } from '../postgreSQLEventStore';
import { defaultTag, messagesTable } from './typing';

type ReadStreamSqlResult<EventType extends Event> = {
  stream_position: string;
  message_data: EventDataOf<EventType>;
  message_metadata: EventMetaDataOf<EventType>;
  message_schema_version: string;
  message_type: EventTypeOf<EventType>;
  message_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

export const readStream = async <EventType extends Event>(
  execute: SQLExecutor,
  streamId: string,
  options?: ReadStreamOptions<BigIntStreamPosition, EventType> & {
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

  const upcast = options?.schema?.versioning?.upcast;

  const events: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    await mapRows(
      execute.query<ReadStreamSqlResult<EventType>>(
        sql(
          `SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${messagesTable.name}
           WHERE stream_id = %L AND partition = %L AND is_archived = FALSE ${fromCondition} ${toCondition}
           ORDER BY stream_position ASC`,
          streamId,
          options?.partition ?? defaultTag,
        ),
      ),
      (row) => {
        const rawEvent = {
          type: row.message_type,
          data: row.message_data,
          metadata: row.message_metadata,
        } as unknown as EventType;

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
            EventType,
            ReadEventMetadataWithGlobalPosition
          >,
        };

        return upcast
          ? (upcast(event) as ReadEvent<
              EventType,
              ReadEventMetadataWithGlobalPosition
            >)
          : event;
      },
    );

  return events.length > 0
    ? {
        currentStreamVersion:
          events[events.length - 1]!.metadata.streamPosition,
        events,
        streamExists: true,
      }
    : {
        currentStreamVersion: PostgreSQLEventStoreDefaultStreamVersion,
        events: [],
        streamExists: false,
      };
};
