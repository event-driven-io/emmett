import { mapRows, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import type {
  CombinedMessageMetadata,
  Message,
  MessageDataOf,
  MessageMetaDataOf,
  MessageTypeOf,
  ProcessorCheckpoint,
  RecordedMessage,
  RecordedMessageMetadata,
  RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { defaultTag, messagesTable } from './typing';

type ReadMessagesBatchSqlResult<MessageType extends Message> = {
  stream_position: string;
  stream_id: string;
  message_data: MessageDataOf<MessageType>;
  message_metadata: MessageMetaDataOf<MessageType>;
  message_schema_version: string;
  message_type: MessageTypeOf<MessageType>;
  message_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

// TODO: Move it to checkpoint related
export const defaultPostgreSQLEventStoreCheckpoint: PostgreSQLEventStoreCheckpoint =
  {
    transactionId: 0n.toString(),
    globalPosition: 0n,
  };

export const PostgreSQLEventStoreCheckpoint = {
  default: defaultPostgreSQLEventStoreCheckpoint,
  parse: (
    checkPoint: ProcessorCheckpoint | undefined | null,
  ): PostgreSQLEventStoreCheckpoint => {
    if (checkPoint === undefined || checkPoint === null)
      return defaultPostgreSQLEventStoreCheckpoint;

    const [transactionId, globalPosition] = checkPoint.includes(':')
      ? checkPoint.split(':')
      : [undefined, checkPoint];
    return {
      transactionId: transactionId ?? 0n.toString(),
      globalPosition: BigInt(globalPosition),
    };
  },
  toProcessorCheckpoint: (
    checkPoint: PostgreSQLEventStoreCheckpoint,
  ): ProcessorCheckpoint =>
    `${checkPoint.transactionId}:${checkPoint.globalPosition}` as ProcessorCheckpoint,
};

export const parseBigIntProcessorCheckpoint = (
  value: ProcessorCheckpoint,
): bigint => BigInt(value);

export type PostgreSQLEventStoreCheckpoint = {
  transactionId: string;
  globalPosition: bigint;
};

export type ReadMessagesBatchOptions =
  | {
      after: PostgreSQLEventStoreCheckpoint;
      batchSize: number;
    }
  | {
      from: PostgreSQLEventStoreCheckpoint;
      batchSize: number;
    }
  | { to: PostgreSQLEventStoreCheckpoint; batchSize: number }
  | {
      from: PostgreSQLEventStoreCheckpoint;
      to: PostgreSQLEventStoreCheckpoint;
    };

export type ReadMessagesBatchResult<
  MessageType extends Message,
  MessageMetadataType extends RecordedMessageMetadata = RecordedMessageMetadata,
> = {
  currentCheckpoint: PostgreSQLEventStoreCheckpoint;
  messages: RecordedMessage<MessageType, MessageMetadataType>[];
  areMessagesLeft: boolean;
};

export const readMessagesBatch = async <
  MessageType extends Message,
  RecordedMessageMetadataType extends
    RecordedMessageMetadataWithGlobalPosition =
    RecordedMessageMetadataWithGlobalPosition,
>(
  execute: SQLExecutor,
  options: ReadMessagesBatchOptions & { partition?: string },
): Promise<
  ReadMessagesBatchResult<MessageType, RecordedMessageMetadataType>
> => {
  const from = 'from' in options ? options.from : undefined;
  const after = 'after' in options ? options.after : undefined;
  const batchSize =
    'batchSize' in options
      ? options.batchSize
      : options.to.globalPosition - options.from.globalPosition;

  const fromCondition: SQL =
    from !== undefined
      ? SQL`AND (transaction_id, global_position) >= (${from.transactionId}, ${from.globalPosition})`
      : after !== undefined
        ? SQL`AND (transaction_id, global_position) > (${after.transactionId}, ${after.globalPosition})`
        : SQL.EMPTY;

  const toCondition: SQL =
    'to' in options
      ? SQL`AND (transaction_id, global_position) <= (${options.to.transactionId}, ${options.to.globalPosition})`
      : SQL.EMPTY;

  const limitCondition: SQL =
    'batchSize' in options ? SQL`LIMIT ${options.batchSize}` : SQL.EMPTY;

  const query = SQL`
    SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id
    FROM ${SQL.identifier(messagesTable.name)}
    WHERE partition = ${options?.partition ?? defaultTag} 
      AND is_archived = FALSE 
      AND transaction_id < pg_snapshot_xmin(pg_current_snapshot())
      ${fromCondition} ${toCondition}
    ORDER BY transaction_id, global_position
    ${limitCondition}`;

  const messages: RecordedMessage<MessageType, RecordedMessageMetadataType>[] =
    await mapRows(
      execute.query<ReadMessagesBatchSqlResult<MessageType>>(query),
      (row) => {
        const rawEvent = {
          type: row.message_type,
          data: row.message_data,
          metadata: row.message_metadata,
        } as unknown as MessageType;

        const metadata: RecordedMessageMetadataWithGlobalPosition = {
          ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
          messageId: row.message_id,
          streamName: row.stream_id,
          streamPosition: BigInt(row.stream_position),
          globalPosition: BigInt(row.global_position),
          checkpoint: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
            transactionId: row.transaction_id,
            globalPosition: BigInt(row.global_position),
          }),
        };

        return {
          ...rawEvent,
          kind: 'Event',
          metadata: metadata as CombinedMessageMetadata<
            MessageType,
            RecordedMessageMetadataType
          >,
        };
      },
    );

  return messages.length > 0
    ? {
        currentCheckpoint: PostgreSQLEventStoreCheckpoint.parse(
          messages[messages.length - 1]!.metadata.checkpoint,
        ),
        messages: messages,
        areMessagesLeft: messages.length === batchSize,
      }
    : {
        currentCheckpoint:
          'from' in options
            ? options.from
            : 'after' in options
              ? options.after
              : defaultPostgreSQLEventStoreCheckpoint,
        messages: [],
        areMessagesLeft: false,
      };
};
