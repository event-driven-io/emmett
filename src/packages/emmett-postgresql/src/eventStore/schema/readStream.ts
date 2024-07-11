import {
  event,
  type DefaultStreamVersionType,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import pg from 'pg';
import { executeSQL, mapRow } from '../../execute';
import { sql } from '../../sql';
import { defaultTag, eventsTable } from './typing';

type ReadStreamSqlResult<EventType extends Event> = {
  stream_position: string;
  event_data: EventDataOf<EventType>;
  event_metadata: EventMetaDataOf<EventType>;
  event_schema_version: string;
  event_type: EventTypeOf<EventType>;
  event_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

export const readStream = async <EventType extends Event>(
  pool: pg.Pool,
  streamId: string,
  options?: ReadStreamOptions & { partition?: string },
): Promise<
  ReadStreamResult<
    EventType,
    DefaultStreamVersionType,
    ReadEventMetadataWithGlobalPosition
  >
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

  const events: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    await mapRow(
      executeSQL<ReadStreamSqlResult<EventType>>(
        pool,
        sql(
          `SELECT stream_id, stream_position, global_position, event_data, event_metadata, event_schema_version, event_type, event_id
           FROM ${eventsTable.name}
           WHERE stream_id = %L AND partition = %L AND is_archived = FALSE ${fromCondition} ${toCondition}`,
          streamId,
          options?.partition ?? defaultTag,
        ),
      ),
      (row) => {
        const rawEvent = event<EventType>(
          row.event_type,
          row.event_data,
          row.event_metadata,
        ) as EventType;

        return {
          ...rawEvent,
          metadata: {
            ...rawEvent.metadata,
            eventId: row.event_id,
            streamName: streamId,
            streamPosition: BigInt(row.stream_position),
            globalPosition: BigInt(row.global_position),
          },
        };
      },
    );

  return events.length > 0
    ? {
        currentStreamVersion:
          events[events.length - 1]!.metadata.streamPosition,
        events,
      }
    : null;
};
