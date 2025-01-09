import {
  event,
  JSONParser,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { type SQLiteConnection } from '../../sqliteConnection';
import { SQLiteEventStoreDefaultStreamVersion } from '../../SQLiteEventStore';
import { defaultTag, eventsTable } from './typing';

type ReadStreamSqlResult<EventType extends Event> = {
  stream_position: string;
  event_data: EventDataOf<EventType>;
  event_metadata: EventMetaDataOf<EventType>;
  event_schema_version: string;
  event_type: EventTypeOf<EventType>;
  event_id: string;
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

  const results = await db.query<ReadStreamSqlResult<EventType>>(
    `SELECT stream_id, stream_position, global_position, event_data, event_metadata, event_schema_version, event_type, event_id
           FROM ${eventsTable.name}
           WHERE stream_id = ? AND partition = ? AND is_archived = FALSE ${fromCondition} ${toCondition}`,
    [streamId, options?.partition ?? defaultTag],
  );

  const events: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    results.map((row) => {
      const rawEvent = event<EventType>(
        row.event_type,
        JSONParser.parse(row.event_data),
        JSONParser.parse(row.event_metadata),
      );

      return {
        ...rawEvent,
        metadata: {
          ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
          eventId: row.event_id,
          streamName: streamId,
          streamPosition: BigInt(row.stream_position),
          globalPosition: BigInt(row.global_position),
        },
      };
    });

  return events.length > 0
    ? {
        currentStreamVersion:
          events[events.length - 1]!.metadata.streamPosition,
        events,
      }
    : {
        currentStreamVersion: SQLiteEventStoreDefaultStreamVersion,
        events: [],
        streamExists: false,
      };
};
