import { mapRows, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  bigIntProcessorCheckpoint,
  type CombinedMessageMetadata,
  type Message,
  type MessageDataOf,
  type MessageMetaDataOf,
  type MessageTypeOf,
  type RecordedMessage,
  type RecordedMessageMetadata,
  type RecordedMessageMetadataWithGlobalPosition,
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
  MessageType extends Message,
  MessageMetadataType extends RecordedMessageMetadata = RecordedMessageMetadata,
> = {
  currentGlobalPosition: bigint;
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
    'batchSize' in options ? options.batchSize : options.to - options.from;

  const fromCondition: SQL =
    from !== undefined
      ? SQL`AND global_position >= ${from}`
      : after !== undefined
        ? SQL`AND global_position > ${after}`
        : SQL.EMPTY;

  const toCondition: SQL =
    'to' in options ? SQL`AND global_position <= ${options.to}` : SQL.EMPTY;

  const limitCondition: SQL =
    'batchSize' in options ? SQL`LIMIT ${options.batchSize}` : SQL.EMPTY;

  const messages: RecordedMessage<MessageType, RecordedMessageMetadataType>[] =
    await mapRows(
      execute.query<ReadMessagesBatchSqlResult<MessageType>>(
        SQL`
          SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${SQL.identifier(messagesTable.name)}
           WHERE partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot()) ${fromCondition} ${toCondition}
           ORDER BY transaction_id, global_position
           ${limitCondition}`,
      ),
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
          checkpoint: bigIntProcessorCheckpoint(BigInt(row.global_position)),
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
        currentGlobalPosition:
          messages[messages.length - 1]!.metadata.globalPosition,
        messages: messages,
        areMessagesLeft: messages.length === batchSize,
      }
    : {
        currentGlobalPosition:
          'from' in options
            ? options.from
            : 'after' in options
              ? options.after
              : 0n,
        messages: [],
        areMessagesLeft: false,
      };
};
