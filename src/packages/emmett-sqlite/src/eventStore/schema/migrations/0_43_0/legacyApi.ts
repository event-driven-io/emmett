import {
  BatchCommandNoChangesError,
  DumboError,
  singleOrNull,
  SQL,
  UniqueConstraintError,
  type AnyDatabaseTransaction,
  type SQLExecutor,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  bigIntProcessorCheckpoint,
  downcastRecordedMessages,
  ExpectedVersionConflictError,
  isExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  upcastRecordedMessage,
  type AppendToStreamOptions,
  type BeforeEventStoreCommitHandler,
  type CombinedReadEventMetadata,
  type Event,
  type ExpectedStreamVersion,
  type JSONSerializer,
  type Event as Message,
  type ObservabilityContext,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import {
  SQLiteEventStoreDefaultStreamVersion,
  type SQLiteEventStore,
  type SQLiteReadEventMetadata,
} from '../../../SQLiteEventStore';
import {
  defaultTag,
  messagesTable,
  streamsTable,
  tableReference,
} from '../../typing';
import { migration_0_43_0_FixStreamPartition } from './0_43_0.migration';

const { merge } = SQL;

export const migrations_0_43_0_rc_2: SQLMigration[] = [
  migration_0_43_0_FixStreamPartition,
];

type AppendEventResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      lastGlobalPosition: bigint;
    }
  | { success: false };

export const appendToStream_0_43_0_rc_2 = async <MessageType extends Message>(
  connection: AnySQLiteConnection,
  streamName: string,
  streamType: string,
  messages: MessageType[],
  options?: AppendToStreamOptions & {
    partition?: string;
    databaseSchemaName?: string;
    messageIdGenerator?: () => string;
    context?: ObservabilityContext;
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      {
        connection: AnySQLiteConnection;
        transaction: AnyDatabaseTransaction;
      }
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
    ): RecordedMessage<MessageType, SQLiteReadEventMetadata> => {
      const messageId = options?.messageIdGenerator?.() ?? uuid();
      return {
        ...m,
        kind: m.kind ?? 'Event',
        metadata: {
          streamName,
          messageId,
          streamPosition: BigInt(i + 1),
          correlationId: options?.context?.correlationId,
          causationId: options?.context?.causationId,
          traceId: options?.context?.traceId,
          spanId: options?.context?.spanId,
          ...('metadata' in m ? (m.metadata ?? {}) : {}),
        },
      } as RecordedMessage<MessageType, SQLiteReadEventMetadata>;
    },
  );

  try {
    return await connection.withTransaction(
      async (transaction: AnyDatabaseTransaction) => {
        const result = await appendToStreamRaw(
          transaction.execute,
          streamName,
          streamType,
          downcastRecordedMessages(
            messagesToAppend,
            options?.schema?.versioning,
          ),
          {
            expectedStreamVersion,
            databaseSchemaName: options?.databaseSchemaName,
          },
        );

        if (result.success)
          messagesToAppend.forEach((message, index) => {
            message.metadata = {
              ...message.metadata,
              streamPosition:
                result.nextStreamPosition -
                BigInt(messagesToAppend.length) +
                BigInt(index + 1),
            };
          });

        if (options?.onBeforeCommit)
          await options.onBeforeCommit(messagesToAppend, {
            connection,
            transaction,
          });

        return { success: true, result };
      },
    );
  } catch (err: unknown) {
    if (
      isExpectedVersionConflictError(err) ||
      DumboError.isInstanceOf(err, {
        errorType: UniqueConstraintError.ErrorType,
      }) ||
      DumboError.isInstanceOf(err, {
        errorType: BatchCommandNoChangesError.ErrorType,
      })
    ) {
      return { success: false };
    }
    throw err;
  }
};

const toExpectedVersion = (
  expected: ExpectedStreamVersion | undefined,
): bigint | null => {
  if (expected === undefined) return null;

  if (expected === NO_CONCURRENCY_CHECK) return null;

  if (expected === STREAM_DOES_NOT_EXIST) return 0n;

  if (expected === STREAM_EXISTS) return -1n;

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
    databaseSchemaName?: string;
  },
): Promise<AppendEventResult> => {
  let expectedStreamVersion = options?.expectedStreamVersion ?? null;

  const currentStreamVersion: bigint | null = await getLastStreamPosition(
    execute,
    streamId,
    expectedStreamVersion,
    options?.databaseSchemaName,
  );

  if (expectedStreamVersion === -1n && currentStreamVersion > 0n)
    expectedStreamVersion = currentStreamVersion;

  expectedStreamVersion ??= currentStreamVersion ?? 0n;

  if (expectedStreamVersion !== currentStreamVersion) {
    throw new ExpectedVersionConflictError(
      currentStreamVersion,
      expectedStreamVersion,
    );
  }

  const streamSQL =
    expectedStreamVersion === 0n
      ? SQL`INSERT INTO ${tableReference(options?.databaseSchemaName, streamsTable.name)}
            (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
            VALUES  (
                ${streamId},
                ${messages.length},
                ${options?.partition ?? defaultTag},
                ${streamType},
                '[]',
                false
            )
            RETURNING stream_position;
          `
      : SQL`UPDATE ${tableReference(options?.databaseSchemaName, streamsTable.name)}
            SET stream_position = stream_position + ${messages.length}
            WHERE stream_id = ${streamId}
            AND stream_position = ${expectedStreamVersion}
            AND partition = ${options?.partition ?? defaultTag}
            AND is_archived = false
            RETURNING stream_position;
          `;

  const insertSQL = buildMessageInsertQuery(
    messages,
    expectedStreamVersion,
    streamId,
    options?.partition?.toString() ?? defaultTag,
    options?.databaseSchemaName,
  );

  const results = await execute.batchCommand<{
    stream_position?: string;
    global_position?: string;
  }>([streamSQL, insertSQL], { assertChanges: true });

  const [streamResult, messagesResult] = results;

  const streamPosition = streamResult?.rows[0]?.stream_position;
  const globalPosition = messagesResult?.rows.at(-1)?.global_position;

  if (!streamPosition)
    throw new ExpectedVersionConflictError(0n, expectedStreamVersion ?? 0n);
  if (!globalPosition) throw new Error('Could not find global position');

  return {
    success: true,
    nextStreamPosition: BigInt(streamPosition),
    lastGlobalPosition: BigInt(globalPosition),
  };
};

async function getLastStreamPosition(
  execute: SQLExecutor,
  streamId: string,
  expectedStreamVersion: bigint | null,
  databaseSchemaName?: string,
): Promise<bigint> {
  const result = await singleOrNull(
    execute.query<{
      stream_position: string;
    }>(
      SQL`SELECT CAST(stream_position AS VARCHAR) AS stream_position FROM ${tableReference(databaseSchemaName, streamsTable.name)} WHERE stream_id = ${streamId}`,
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
  databaseSchemaName?: string,
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

    return SQL`(${streamId},${streamPosition ?? 0n},${partition ?? defaultTag},${message.kind === 'Event' ? 'E' : 'C'},${message.data},${message.metadata},${message.metadata.schemaVersion ?? '1'},${message.type},${message.metadata.messageId},${false})`;
  });

  return SQL`
      INSERT INTO ${tableReference(databaseSchemaName, messagesTable.name)} (
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

type ReadStreamSqlResult = {
  stream_position: string;
  message_data: string;
  message_metadata: string;
  message_schema_version: string;
  message_type: string;
  message_id: string;
  global_position: string;
  created: string;
};

export const readStream_0_43_0_rc_2 = async <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  execute: SQLExecutor,
  streamId: string,
  options: ReadStreamOptions<EventType, EventPayloadType> & {
    partition?: string;
    databaseSchemaName?: string;
    serializer: JSONSerializer;
  },
): Promise<
  ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
> => {
  const { serializer } = options;
  const fromCondition: SQL = options.from
    ? SQL`AND stream_position >= ${options.from}`
    : SQL.EMPTY;

  const to = Number(
    options?.to ??
      (options?.maxCount ? (options.from ?? 0n) + options.maxCount : NaN),
  );

  const toCondition: SQL = !isNaN(to)
    ? SQL`AND stream_position <= ${to}`
    : SQL.EMPTY;

  const { rows: results } = await execute.query<ReadStreamSqlResult>(
    SQL`SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id
        FROM ${tableReference(options?.databaseSchemaName, messagesTable.name)}
        WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${fromCondition} ${toCondition}
        ORDER BY stream_position ASC`,
  );

  const messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    results.map((row) => {
      const rawEvent = {
        type: row.message_type,
        data: serializer.deserialize(row.message_data),
        metadata: serializer.deserialize(row.message_metadata),
      } as unknown as EventPayloadType;

      const metadata: ReadEventMetadataWithGlobalPosition = {
        schemaVersion: '1',
        ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
        messageId: row.message_id,
        streamName: streamId,
        streamPosition: BigInt(row.stream_position),
        globalPosition: bigIntProcessorCheckpoint(BigInt(row.global_position)),
        checkpoint: bigIntProcessorCheckpoint(BigInt(row.global_position)),
      };

      const event = {
        ...rawEvent,
        kind: 'Event',
        metadata: metadata as CombinedReadEventMetadata<
          EventPayloadType,
          ReadEventMetadataWithGlobalPosition
        >,
      };

      return upcastRecordedMessage(event, options?.schema?.versioning);
    });

  return messages.length > 0
    ? {
        currentStreamVersion:
          messages[messages.length - 1]!.metadata.streamPosition,
        events: messages,
        streamExists: true,
      }
    : {
        currentStreamVersion: SQLiteEventStoreDefaultStreamVersion,
        events: [],
        streamExists: false,
      };
};
