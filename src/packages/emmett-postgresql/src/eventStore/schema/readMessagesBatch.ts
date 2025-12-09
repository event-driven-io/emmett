import { mapRows, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import {
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
    from !== -0n ? `AND global_position >= ${from}` : '';

  const toCondition =
    'to' in options ? `AND global_position <= ${options.to}` : '';

  const limitCondition =
    'batchSize' in options ? `LIMIT ${options.batchSize}` : '';

  const messages: RecordedMessage<MessageType, RecordedMessageMetadataType>[] =
    await mapRows(
      execute.query<ReadMessagesBatchSqlResult<MessageType>>(
        sql(
          `SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
           FROM ${messagesTable.name}
           WHERE partition = %L AND is_archived = FALSE AND transaction_id < pg_snapshot_xmin(pg_current_snapshot()) ${fromCondition} ${toCondition}
           ORDER BY transaction_id, global_position
           ${limitCondition}`,
          options?.partition ?? defaultTag,
        ),
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
