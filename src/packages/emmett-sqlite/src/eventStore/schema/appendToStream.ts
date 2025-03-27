import {
  JSONParser,
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
import {
  isSQLiteError,
  type Parameters,
  type SQLiteConnection,
  type SQLiteError,
} from '../../connection';
import type {
  SQLiteEventStore,
  SQLiteReadEventMetadata,
} from '../SQLiteEventStore';
import { defaultTag, messagesTable, streamsTable } from './typing';

export type AppendEventResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      lastGlobalPosition: bigint;
    }
  | { success: false };

export const appendToStream = async <MessageType extends Message>(
  connection: SQLiteConnection,
  streamName: string,
  streamType: string,
  messages: MessageType[],
  options?: AppendToStreamOptions & {
    partition?: string;
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      { connection: SQLiteConnection }
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

  let result: AppendEventResult;

  return await connection.withTransaction(async () => {
    result = await appendToStreamRaw(
      connection,
      streamName,
      streamType,
      messagesToAppend,
      {
        expectedStreamVersion,
      },
    );

    if (options?.onBeforeCommit)
      await options.onBeforeCommit(messagesToAppend, { connection });

    return result;
  });
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
  connection: SQLiteConnection,
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
        connection,
        streamId,
        expectedStreamVersion,
      );
    }

    let position: { stream_position: string } | null;

    if (expectedStreamVersion === 0n) {
      position = await connection.querySingle<{
        stream_position: string;
      } | null>(
        `INSERT INTO ${streamsTable.name}
            (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES  (
                ?,
                ?,
                ?,
                ?,
                '[]',
                false
            )
            RETURNING stream_position;
          `,
        [
          streamId,
          messages.length,
          options?.partition ?? streamsTable.columns.partition,
          streamType,
        ],
      );
    } else {
      position = await connection.querySingle<{
        stream_position: string;
      } | null>(
        `UPDATE ${streamsTable.name}
            SET stream_position = stream_position + ?
            WHERE stream_id = ?
            AND partition = ?
            AND is_archived = false
            RETURNING stream_position;
          `,
        [
          messages.length,
          streamId,
          options?.partition ?? streamsTable.columns.partition,
        ],
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

    const { sqlString, values } = buildMessageInsertQuery(
      messages,
      expectedStreamVersion,
      streamId,
      options?.partition?.toString() ?? defaultTag,
    );

    const returningIds = await connection.query<{
      global_position: string;
    } | null>(sqlString, values);

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
  connection: SQLiteConnection,
  streamId: string,
  expectedStreamVersion: bigint | null,
): Promise<bigint> {
  const result = await connection.querySingle<{
    stream_position: string;
  } | null>(
    `SELECT CAST(stream_position AS VARCHAR) AS stream_position FROM ${streamsTable.name} WHERE stream_id = ?`,
    [streamId],
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
): {
  sqlString: string;
  values: Parameters[];
} => {
  const query = messages.reduce(
    (
      queryBuilder: { parameterMarkers: string[]; values: Parameters[] },
      message: RecordedMessage,
    ) => {
      if (
        message.metadata?.streamPosition == null ||
        typeof message.metadata.streamPosition !== 'bigint'
      ) {
        throw new Error('Stream position is required');
      }

      const streamPosition =
        BigInt(message.metadata.streamPosition) + BigInt(expectedStreamVersion);

      queryBuilder.parameterMarkers.push(`(?,?,?,?,?,?,?,?,?,?)`);
      queryBuilder.values.push(
        streamId,
        streamPosition.toString() ?? 0,
        partition ?? defaultTag,
        message.kind === 'Event' ? 'E' : 'C',
        JSONParser.stringify(message.data),
        JSONParser.stringify(message.metadata),
        expectedStreamVersion?.toString() ?? 0,
        message.type,
        message.metadata.messageId,
        false,
      );

      return queryBuilder;
    },
    {
      parameterMarkers: [],
      values: [],
    },
  );

  const sqlString = `
      INSERT INTO ${messagesTable.name} (
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
      VALUES ${query.parameterMarkers.join(', ')} 
      RETURNING 
        CAST(global_position as VARCHAR) AS global_position
    `;
  return { sqlString, values: query.values };
};
