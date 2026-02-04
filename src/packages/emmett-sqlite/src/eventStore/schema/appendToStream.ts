import {
  singleOrNull,
  SQL,
  type AnyDatabaseTransaction,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  isSQLiteError,
  type AnySQLiteConnection,
  type SQLiteError,
} from '@event-driven-io/dumbo/sqlite3';
import {
  downcastRecordedMessages,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AppendToStreamOptions,
  type BeforeEventStoreCommitHandler,
  type ExpectedStreamVersion,
  type Event as Message,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import type {
  SQLiteEventStore,
  SQLiteReadEventMetadata,
} from '../SQLiteEventStore';
import { defaultTag, messagesTable, streamsTable } from './typing';

const { identifier, merge } = SQL;

export type AppendEventResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      lastGlobalPosition: bigint;
    }
  | { success: false };

export const appendToStream = async <MessageType extends Message>(
  connection: AnySQLiteConnection,
  streamName: string,
  streamType: string,
  messages: MessageType[],
  options?: AppendToStreamOptions & {
    partition?: string;
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      { connection: AnySQLiteConnection }
    >;
  },
): Promise<AppendEventResult> => {
  if (messages.length === 0) return { success: false };

  const expectedStreamVersion = toExpectedVersion(
    options?.expectedStreamVersion,
  );

  const messagesToAppend: RecordedMessage<
    MessageType,
    SQLiteReadEventMetadata
  >[] = messages.map(
    (
      m: Message,
      i: number,
    ): RecordedMessage<MessageType, SQLiteReadEventMetadata> =>
      ({
        ...m,
        kind: m.kind ?? 'Event',
        metadata: {
          streamName,
          messageId: uuid(),
          streamPosition: BigInt(i + 1),
          ...('metadata' in m ? (m.metadata ?? {}) : {}),
        },
      }) as RecordedMessage<MessageType, SQLiteReadEventMetadata>,
  );

  return await connection.withTransaction(
    async (transaction: AnyDatabaseTransaction) => {
      const result = await appendToStreamRaw(
        transaction.execute,
        streamName,
        streamType,
        downcastRecordedMessages(messagesToAppend, options?.schema?.versioning),
        {
          expectedStreamVersion,
        },
      );

      if (options?.onBeforeCommit)
        await options.onBeforeCommit(messagesToAppend, { connection });

      // TODO: Refactor this to map or not success from appendToStreamRaw
      return { success: true, result };
    },
  );
};

const toExpectedVersion = (
  expected: ExpectedStreamVersion | undefined,
): bigint | null => {
  if (expected === undefined) return null;

  if (expected === NO_CONCURRENCY_CHECK) return null;

  // TODO: this needs to be fixed
  if (expected == STREAM_DOES_NOT_EXIST) return null;

  // TODO: this needs to be fixed
  if (expected == STREAM_EXISTS) return null;

  return expected as bigint;
};

const appendToStreamRaw = async (
  execute: SQLExecutor,
  streamId: string,
  streamType: string,
  messages: RecordedMessage[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
  },
): Promise<AppendEventResult> => {
  let streamPosition;
  let globalPosition;

  try {
    let expectedStreamVersion = options?.expectedStreamVersion ?? null;

    if (expectedStreamVersion == null) {
      expectedStreamVersion = await getLastStreamPosition(
        execute,
        streamId,
        expectedStreamVersion,
      );
    }

    let position: { stream_position: string } | null;

    if (expectedStreamVersion === 0n) {
      position = await singleOrNull(
        execute.query<{
          stream_position: string;
        }>(
          SQL`INSERT INTO ${identifier(streamsTable.name)}
            (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES  (
                ${streamId},
                ${messages.length},
                ${options?.partition ?? streamsTable.columns.partition},
                ${streamType},
                '[]',
                false
            )
            RETURNING stream_position;
          `,
        ),
      );
    } else {
      position = await singleOrNull(
        execute.query<{
          stream_position: string;
        }>(
          SQL`UPDATE ${identifier(streamsTable.name)}
            SET stream_position = stream_position + ${messages.length}
            WHERE stream_id = ${streamId}
            AND partition = ${options?.partition ?? streamsTable.columns.partition}
            AND is_archived = false
            RETURNING stream_position;
          `,
        ),
      );
    }

    if (position == null) {
      throw new Error('Could not find stream position');
    }

    streamPosition = BigInt(position.stream_position);

    if (expectedStreamVersion != null) {
      const expectedStreamPositionAfterSave =
        BigInt(expectedStreamVersion) + BigInt(messages.length);
      if (streamPosition !== expectedStreamPositionAfterSave) {
        return {
          success: false,
        };
      }
    }

    const insertSQL = buildMessageInsertQuery(
      messages,
      expectedStreamVersion,
      streamId,
      options?.partition?.toString() ?? defaultTag,
    );

    const { rows: returningIds } = await execute.query<{
      global_position: string;
    }>(insertSQL);

    if (
      returningIds.length === 0 ||
      !returningIds[returningIds.length - 1]?.global_position
    ) {
      throw new Error('Could not find global position');
    }

    globalPosition = BigInt(
      returningIds[returningIds.length - 1]!.global_position,
    );
  } catch (err: unknown) {
    if (isSQLiteError(err) && isOptimisticConcurrencyError(err)) {
      return {
        success: false,
      };
    }

    throw err;
  }

  return {
    success: true,
    nextStreamPosition: streamPosition,
    lastGlobalPosition: globalPosition,
  };
};

const isOptimisticConcurrencyError = (error: SQLiteError): boolean => {
  return error?.errno !== undefined && error.errno === 19;
};

async function getLastStreamPosition(
  execute: SQLExecutor,
  streamId: string,
  expectedStreamVersion: bigint | null,
): Promise<bigint> {
  const result = await singleOrNull(
    execute.query<{
      stream_position: string;
    }>(
      SQL`SELECT CAST(stream_position AS VARCHAR) AS stream_position FROM ${identifier(streamsTable.name)} WHERE stream_id = ${streamId}`,
    ),
  );

  if (result?.stream_position == null) {
    expectedStreamVersion = 0n;
  } else {
    expectedStreamVersion = BigInt(result.stream_position);
  }
  return expectedStreamVersion;
}

const buildMessageInsertQuery = (
  messages: RecordedMessage[],
  expectedStreamVersion: bigint,
  streamId: string,
  partition: string | null | undefined,
): SQL => {
  const values = messages.map((message: RecordedMessage) => {
    if (
      message.metadata?.streamPosition == null ||
      typeof message.metadata.streamPosition !== 'bigint'
    ) {
      throw new Error('Stream position is required');
    }

    const streamPosition =
      BigInt(message.metadata.streamPosition) + BigInt(expectedStreamVersion);

    return SQL`(${streamId},${streamPosition ?? 0n},${partition ?? defaultTag},${message.kind === 'Event' ? 'E' : 'C'},${message.data},${message.metadata},${expectedStreamVersion ?? 0n},${message.type},${message.metadata.messageId},${false})`;
  });

  return SQL`
      INSERT INTO ${identifier(messagesTable.name)} (
          stream_id, 
          stream_position, 
          partition, 
          message_kind,
          message_data, 
          message_metadata, 
          message_schema_version, 
          message_type, 
          message_id, 
          is_archived
      ) 
      VALUES ${merge(values, ',')} 
      RETURNING 
        CAST(global_position as VARCHAR) AS global_position
    `;
};
