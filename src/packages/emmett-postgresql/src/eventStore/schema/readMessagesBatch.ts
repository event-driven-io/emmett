import { mapRows, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  event,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ReadEvent,
  type ReadEventMetadata,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { defaultTag, eventsTable } from './typing';

type ReadMessagesBatchSqlResult<EventType extends Event> = {
  stream_position: string;
  stream_id: string;
  event_data: EventDataOf<EventType>;
  event_metadata: EventMetaDataOf<EventType>;
  event_schema_version: string;
  event_type: EventTypeOf<EventType>;
  event_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

export type ReadMessagesBatchOptions =
  | {
      from: bigint;
      batchSize: number;
    }
  | { to: bigint; batchSize: number }
  | { from: bigint; to: bigint };

export type ReadMessagesBatchResult<
  EventType extends Event,
  ReadEventMetadataType extends ReadEventMetadata = ReadEventMetadata,
> = {
  currentGlobalPosition: bigint;
  events: ReadEvent<EventType, ReadEventMetadataType>[];
  areEventsLeft: boolean;
};

export const readMessagesBatch = async <
  MessageType extends Event,
  ReadEventMetadataType extends
    ReadEventMetadataWithGlobalPosition = ReadEventMetadataWithGlobalPosition,
>(
  execute: SQLExecutor,
  options: ReadMessagesBatchOptions & { partition?: string },
): Promise<ReadMessagesBatchResult<MessageType, ReadEventMetadataType>> => {
  const from = 'from' in options ? options.from : 0n;
  const batchSize =
    options && 'batchSize' in options
      ? options.batchSize
      : options.to - options.from;
  const to = Number(
    'to' in options ? options.to : from + BigInt(options.batchSize),
  );

  const fromCondition: string =
    from !== -0n ? `AND global_position >= ${from}` : '';

  const toCondition = !isNaN(to) ? `AND global_position <= ${to}` : '';

  const events: ReadEvent<MessageType, ReadEventMetadataType>[] = await mapRows(
    execute.query<ReadMessagesBatchSqlResult<MessageType>>(
      sql(
        `SELECT stream_id, stream_position, global_position, event_data, event_metadata, event_schema_version, event_type, event_id
           FROM ${eventsTable.name}
           WHERE partition = %L AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot()) ${fromCondition} ${toCondition}
           ORDER BY transaction_id, global_position`,
        options?.partition ?? defaultTag,
      ),
    ),
    (row) => {
      const rawEvent = event<MessageType>(
        row.event_type,
        row.event_data,
        row.event_metadata,
      ) as MessageType;

      const metadata: ReadEventMetadataWithGlobalPosition = {
        ...rawEvent.metadata,
        eventId: row.event_id,
        streamName: row.stream_id,
        streamPosition: BigInt(row.stream_position),
        globalPosition: BigInt(row.global_position),
      };

      return {
        ...rawEvent,
        metadata: metadata as ReadEventMetadataType,
      };
    },
  );

  return events.length > 0
    ? {
        currentGlobalPosition:
          events[events.length - 1]!.metadata.globalPosition,
        events,
        areEventsLeft: events.length === batchSize,
      }
    : {
        currentGlobalPosition: from,
        events: [],
        areEventsLeft: false,
      };
};
