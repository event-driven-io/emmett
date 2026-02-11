import { SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  bigIntProcessorCheckpoint,
  JSONParser,
  type CombinedReadEventMetadata,
  type Event,
  type ReadEvent,
  type ReadEventMetadata,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { defaultTag, messagesTable } from './typing';
const { identifier } = SQL;

type ReadMessagesBatchSqlResult = {
  stream_position: string;
  stream_id: string;
  message_data: string;
  message_metadata: string;
  message_schema_version: string;
  message_type: string;
  message_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

export type ReadMessagesBatchOptions =
  | {
      after: bigint;
      batchSize: number;
    }
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
  messages: ReadEvent<EventType, ReadEventMetadataType>[];
  areEventsLeft: boolean;
};

export const readMessagesBatch = async <
  MessageType extends Event,
  ReadEventMetadataType extends ReadEventMetadataWithGlobalPosition =
    ReadEventMetadataWithGlobalPosition,
>(
  execute: SQLExecutor,
  options: ReadMessagesBatchOptions & { partition?: string },
): Promise<ReadMessagesBatchResult<MessageType, ReadEventMetadataType>> => {
  const from =
    'from' in options
      ? options.from
      : 'after' in options
        ? options.after + 1n
        : 0n;
  const batchSize =
    options && 'batchSize' in options
      ? options.batchSize
      : options.to - options.from;

  const fromCondition: string =
    from !== -0n ? SQL`AND global_position >= ${from}` : '';

  const toCondition: SQL =
    'to' in options ? SQL`AND global_position <= ${options.to}` : SQL.EMPTY;

  const limitCondition: SQL =
    'batchSize' in options ? SQL`LIMIT ${options.batchSize}` : SQL.EMPTY;

  const events: ReadEvent<MessageType, ReadEventMetadataType>[] = (
    await execute.query<ReadMessagesBatchSqlResult>(
      SQL`SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${identifier(messagesTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${fromCondition} ${toCondition}
           ORDER BY global_position
           ${limitCondition}`,
    )
  ).rows.map((row) => {
    const rawEvent = {
      type: row.message_type,
      data: JSONParser.parse(row.message_data),
      metadata: JSONParser.parse(row.message_metadata),
    } as unknown as MessageType;

    const metadata: ReadEventMetadataWithGlobalPosition = {
      ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
      messageId: row.message_id,
      streamName: row.stream_id,
      streamPosition: BigInt(row.stream_position),
      globalPosition: BigInt(row.global_position),
      checkpoint: bigIntProcessorCheckpoint(BigInt(row.global_position)),
    };

    return {
      ...rawEvent,
      kind: 'Event',
      metadata: metadata as CombinedReadEventMetadata<
        MessageType,
        ReadEventMetadataType
      >,
    };
  });

  return events.length > 0
    ? {
        currentGlobalPosition:
          events[events.length - 1]!.metadata.globalPosition,
        messages: events,
        areEventsLeft: events.length === batchSize,
      }
    : {
        currentGlobalPosition:
          'from' in options
            ? options.from
            : 'after' in options
              ? options.after
              : 0n,
        messages: [],
        areEventsLeft: false,
      };
};
