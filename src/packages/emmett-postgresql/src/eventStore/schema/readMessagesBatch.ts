import { mapRows, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  event,
  type DefaultStreamVersionType,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import { PostgreSQLEventStoreDefaultStreamVersion } from '../postgreSQLEventStore';
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
    }
  | { to: bigint }
  | { from: bigint; batchSize?: number }
  | { batchSize: number };

export const readMessagesBatch = async <MessageType extends Event>(
  execute: SQLExecutor,
  options?: ReadMessagesBatchOptions & { partition?: string },
): Promise<
  ReadStreamResult<
    MessageType,
    DefaultStreamVersionType,
    ReadEventMetadataWithGlobalPosition
  >
> => {
  const fromCondition: string =
    options && 'from' in options
      ? `AND global_position >= ${options.from}`
      : '';

  const to = Number(
    options && 'to' in options
      ? options.to
      : options && 'batchSize' in options && options.batchSize
        ? (options && 'from' in options ? options.from : 0n) +
          BigInt(options.batchSize)
        : NaN,
  );

  const toCondition = !isNaN(to) ? `AND global_position <= ${to}` : '';

  const events: ReadEvent<MessageType, ReadEventMetadataWithGlobalPosition>[] =
    await mapRows(
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

        return {
          ...rawEvent,
          metadata: {
            ...rawEvent.metadata,
            eventId: row.event_id,
            streamName: row.stream_id,
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
        streamExists: true,
      }
    : {
        currentStreamVersion: PostgreSQLEventStoreDefaultStreamVersion,
        events: [],
        streamExists: false,
      };
};
