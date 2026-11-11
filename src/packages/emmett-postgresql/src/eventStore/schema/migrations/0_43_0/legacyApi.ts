import {
  DumboError,
  mapRows,
  single,
  SQL,
  UniqueConstraintError,
  type SQLExecutor,
  type SQLMigration,
} from '@event-driven-io/dumbo';
import type { PgConnection, PgTransaction } from '@event-driven-io/dumbo/pg';
import {
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  upcastRecordedMessage,
  type AppendToStreamOptions,
  type CombinedReadEventMetadata,
  type DefaultRecord,
  type Event,
  type EventDataOf,
  type EventMetaDataOf,
  type EventTypeOf,
  type ExpectedStreamVersion,
  type Message,
  type ObservabilityContext,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { PostgreSQLEventStoreDefaultStreamVersion } from '../../../postgreSQLEventStore';
import { postgreSQLFunctionName } from '../../postgreSQLFunctionName';
import { PostgreSQLEventStoreCheckpoint } from '../../readMessagesBatch';
import { defaultTag, messagesTable, tableReference } from '../../typing';
import {
  migration_0_43_0_addMessagesPollIndex,
  migration_0_43_0_cleanupLegacySubscription,
  migration_0_43_0_enforceStreamExistence,
  migration_0_43_0_storeFirstCheckpointOverLockPlaceholder,
  migration_0_43_0_updateStoreProcessorCheckpoint,
  migration_0_43_0_upgradeCheckpointFormat,
} from './0_43_0.migration';

export {
  appendToStream,
  readEvents,
  storeProcessorCheckpoint,
  readProcessorCheckpoint,
  type StoreProcessorCheckpointResult,
} from '../0_42_0/legacyApi';

export const migrations_0_43_0_rc_2: SQLMigration[] = [
  migration_0_43_0_cleanupLegacySubscription,
  migration_0_43_0_updateStoreProcessorCheckpoint,
  migration_0_43_0_storeFirstCheckpointOverLockPlaceholder,
  migration_0_43_0_upgradeCheckpointFormat,
  migration_0_43_0_addMessagesPollIndex,
  migration_0_43_0_enforceStreamExistence,
];

type CallAppendToStreamParams = {
  databaseSchemaName?: string;
  messageIds: string[];
  messagesData: DefaultRecord[];
  messagesMetadata: DefaultRecord[];
  schemaVersions: string[];
  messageTypes: string[];
  messageKinds: string[];
  streamId: string;
  streamType: string;
  expectedStreamPosition: bigint | null;
  partition: string;
};

export const callAppendToStream = (params: CallAppendToStreamParams) =>
  SQL`SELECT * FROM ${postgreSQLFunctionName(params.databaseSchemaName, 'emt_append_to_stream')}(
      ${params.messageIds},
      ${params.messagesData},
      ${params.messagesMetadata},
      ${params.schemaVersions},
      ${params.messageTypes},
      ${params.messageKinds},
      ${params.streamId}::text,
      ${params.streamType}::text,
      ${params.expectedStreamPosition},
      ${params.partition}::text
    )`;

type AppendToStreamResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      checkpoints: PostgreSQLEventStoreCheckpoint[];
    }
  | { success: false };

type AppendToStreamBeforeCommitHook = (
  messages: RecordedMessage[],
  context: {
    connection: PgConnection;
    transaction: PgTransaction;
  },
) => Promise<void>;

export const appendToStream_0_43_0_rc_2 = (
  connection: PgConnection,
  streamName: string,
  streamType: string,
  messages: Message[],
  options?: AppendToStreamOptions & {
    partition?: string;
    messageIdGenerator?: () => string;
    context?: ObservabilityContext;
    beforeCommitHook?: AppendToStreamBeforeCommitHook;
    databaseSchemaName?: string;
  },
): Promise<AppendToStreamResult> =>
  connection.withTransaction<AppendToStreamResult>(async (transaction) => {
    const { execute } = transaction;

    if (messages.length === 0)
      return { success: false, result: { success: false } };

    try {
      const expectedStreamVersion = toExpectedVersion(
        options?.expectedStreamVersion,
      );

      const messagesToAppend: RecordedMessage[] = messages.map((e) => {
        const messageId = options?.messageIdGenerator?.() ?? uuid();
        return {
          ...e,
          kind: e.kind ?? 'Event',
          metadata: {
            messageId,
            correlationId: options?.context?.correlationId,
            causationId: options?.context?.causationId,
            traceId: options?.context?.traceId,
            spanId: options?.context?.spanId,
            ...('metadata' in e ? (e.metadata ?? {}) : {}),
          },
        };
      }) as RecordedMessage[];

      const {
        success,
        next_stream_position,
        global_positions,
        transaction_id,
      } = await appentToStreamRaw(
        execute,
        streamName,
        streamType,
        messagesToAppend,
        {
          expectedStreamVersion,
          databaseSchemaName: options?.databaseSchemaName,
        },
      );

      if (
        !success ||
        next_stream_position === null ||
        global_positions === null ||
        global_positions.length === 0 ||
        transaction_id == null
      ) {
        return {
          success: false,

          result: { success: false },
        };
      }

      const nextStreamPosition = BigInt(next_stream_position);

      const globalPositions = global_positions.map(BigInt);
      const transactionId = BigInt(transaction_id);

      globalPositions.forEach((globalPosition, index) => {
        messagesToAppend[index]!.metadata = {
          ...messagesToAppend[index]!.metadata,
          streamName,
          streamPosition:
            nextStreamPosition -
            BigInt(messagesToAppend.length) +
            BigInt(index + 1),
          globalPosition: PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
            transactionId,
            globalPosition,
          }),
        };
      });

      if (options?.beforeCommitHook)
        await options.beforeCommitHook(messagesToAppend, {
          connection,
          transaction,
        });

      return {
        success: true,

        result: {
          success: true,
          nextStreamPosition,
          checkpoints: globalPositions.map((globalPosition) => ({
            transactionId,
            globalPosition,
          })),
        },
      };
    } catch (error) {
      if (!isOptimisticConcurrencyError(error)) throw error;

      return {
        success: false,
        result: { success: false },
      };
    }
  });

const toExpectedVersion = (
  expected: ExpectedStreamVersion | undefined,
): bigint | null => {
  if (expected === undefined) return null;

  if (expected === NO_CONCURRENCY_CHECK) return null;

  if (expected === STREAM_DOES_NOT_EXIST) return 0n;

  if (expected === STREAM_EXISTS) return -1n;

  return expected as bigint;
};

const isOptimisticConcurrencyError = (error: unknown): boolean =>
  DumboError.isInstanceOf(error, {
    errorType: UniqueConstraintError.ErrorType,
  });

type AppendToStreamSqlResult = {
  success: boolean;
  next_stream_position: string | null;
  global_positions: string[] | null;
  transaction_id: string | null | undefined;
};

const appentToStreamRaw = (
  execute: SQLExecutor,
  streamId: string,
  streamType: string,
  messages: RecordedMessage[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
    databaseSchemaName?: string;
  },
): Promise<AppendToStreamSqlResult> =>
  single(
    execute.command<AppendToStreamSqlResult>(
      callAppendToStream({
        databaseSchemaName: options?.databaseSchemaName,
        messageIds: messages.map((e) => e.metadata.messageId),
        messagesData: messages.map((e) => e.data),
        messagesMetadata: messages.map((e) => {
          const { messageId: _messageId, ...rawMetadata } = e.metadata;
          return rawMetadata;
        }),
        schemaVersions: messages.map((e) => e.metadata.schemaVersion ?? '1'),
        messageTypes: messages.map((e) => e.type),
        messageKinds: messages.map((e) => (e.kind === 'Event' ? 'E' : 'C')),
        streamId,
        streamType,
        expectedStreamPosition: options?.expectedStreamVersion ?? null,
        partition: options?.partition ?? defaultTag,
      }),
    ),
  );

type ReadStreamSqlResult<EventType extends Event> = {
  stream_position: string;
  message_data: EventDataOf<EventType>;
  message_metadata: EventMetaDataOf<EventType>;
  message_schema_version: string;
  message_type: EventTypeOf<EventType>;
  message_id: string;
  global_position: string;
  transaction_id: string;
  created: string;
};

export const readStream_0_43_0_rc_2 = async <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  execute: SQLExecutor,
  streamId: string,
  options?: ReadStreamOptions<EventType, EventPayloadType> & {
    partition?: string;
    databaseSchemaName?: string;
  },
): Promise<
  ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
> => {
  const fromCondition: string = options?.from
    ? `AND stream_position >= ${options.from}`
    : '';

  const to = Number(
    options?.to ??
      (options?.maxCount ? (options.from ?? 0n) + options.maxCount : NaN),
  );

  const toCondition = !isNaN(to) ? `AND stream_position <= ${to}` : '';

  const events: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[] =
    await mapRows(
      execute.query<ReadStreamSqlResult<EventPayloadType>>(
        SQL`SELECT stream_id, stream_position, global_position, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id
           FROM ${tableReference(options?.databaseSchemaName, messagesTable.name)}
           WHERE stream_id = ${streamId} AND partition = ${options?.partition ?? defaultTag} AND is_archived = FALSE ${SQL.plain(fromCondition)} ${SQL.plain(toCondition)}
           ORDER BY stream_position ASC`,
      ),
      (row) => {
        const rawEvent = {
          type: row.message_type,
          data: row.message_data,
          metadata: row.message_metadata,
        } as unknown as EventPayloadType;

        const globalPosition =
          PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
            transactionId: BigInt(row.transaction_id),
            globalPosition: BigInt(row.global_position),
          });

        const metadata: ReadEventMetadataWithGlobalPosition = {
          schemaVersion: '1',
          ...('metadata' in rawEvent ? (rawEvent.metadata ?? {}) : {}),
          messageId: row.message_id,
          streamName: streamId,
          streamPosition: BigInt(row.stream_position),
          globalPosition,
          checkpoint: globalPosition,
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
