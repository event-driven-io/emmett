import {
  single,
  sql,
  type NodePostgresPool,
  type NodePostgresTransaction,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import {
  JSONParser,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AppendToStreamOptions,
  type ExpectedStreamVersion,
  type Message,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { createFunctionIfDoesNotExistSQL } from './createFunctionIfDoesNotExist';
import { defaultTag, messagesTable, streamsTable } from './typing';

export const appendToStreamSQL = createFunctionIfDoesNotExistSQL(
  'emt_append_to_stream',
  `CREATE OR REPLACE FUNCTION emt_append_to_stream(
      v_message_ids text[],
      v_messages_data jsonb[],
      v_messages_metadata jsonb[],
      v_message_schema_versions text[],
      v_message_types text[],
      v_message_kinds text[],
      v_stream_id text,
      v_stream_type text,
      v_expected_stream_position bigint DEFAULT NULL,
      v_partition text DEFAULT emt_sanitize_name('default_partition')
  ) RETURNS TABLE (
      success boolean,
      next_stream_position bigint,
      global_positions bigint[],
      transaction_id xid8
  ) LANGUAGE plpgsql
  AS $emt_append_to_stream$
  DECLARE
      v_next_stream_position bigint;
      v_position bigint;
      v_updated_rows int;
      v_transaction_id xid8;
      v_global_positions bigint[];
  BEGIN
      v_transaction_id := pg_current_xact_id();

      IF v_expected_stream_position IS NULL THEN
          SELECT COALESCE(
            (SELECT stream_position 
            FROM ${streamsTable.name}
            WHERE stream_id = v_stream_id 
              AND partition = v_partition 
              AND is_archived = FALSE
            LIMIT 1), 
            0
        ) INTO v_expected_stream_position;
      END IF;

      v_next_stream_position := v_expected_stream_position + array_upper(v_messages_data, 1);

      IF v_expected_stream_position = 0 THEN
          INSERT INTO ${streamsTable.name}
              (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
          VALUES
              (v_stream_id, v_next_stream_position, v_partition, v_stream_type, '{}', FALSE);
      ELSE
          UPDATE ${streamsTable.name} as s              
          SET stream_position = v_next_stream_position
          WHERE stream_id = v_stream_id AND stream_position = v_expected_stream_position AND partition = v_partition AND is_archived = FALSE;

          get diagnostics v_updated_rows = row_count;

          IF v_updated_rows = 0 THEN
              RETURN QUERY SELECT FALSE, NULL::bigint, NULL::bigint[], NULL::xid8;
              RETURN;
          END IF;
      END IF;

      WITH ev AS (
          SELECT row_number() OVER () + v_expected_stream_position AS stream_position, 
                message_data, 
                message_metadata, 
                schema_version, 
                message_id, 
                message_type,
                message_kind
          FROM (
              SELECT *
              FROM 
                unnest(v_message_ids, v_messages_data, v_messages_metadata, v_message_schema_versions, v_message_types, v_message_kinds) 
              AS message(message_id, message_data, message_metadata, schema_version, message_type, message_kind)
          ) AS message
      ),
      all_messages_insert AS (
          INSERT INTO ${messagesTable.name}
              (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_kind, message_id, transaction_id)
          SELECT 
              v_stream_id, ev.stream_position, v_partition, ev.message_data, ev.message_metadata, ev.schema_version, ev.message_type, ev.message_kind, ev.message_id, v_transaction_id
          FROM ev
          RETURNING global_position
      )
      SELECT 
          array_agg(global_position ORDER BY global_position) INTO v_global_positions
      FROM 
          all_messages_insert;

      RETURN QUERY SELECT TRUE, v_next_stream_position, v_global_positions, v_transaction_id;
  END;
  $emt_append_to_stream$;
  `,
);

type AppendToStreamResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      globalPositions: bigint[];
      transactionId: string;
    }
  | { success: false };

export type AppendToStreamBeforeCommitHook = (
  messages: RecordedMessage[],
  context: {
    transaction: NodePostgresTransaction;
  },
) => Promise<void>;

export const appendToStream = (
  pool: NodePostgresPool,
  streamName: string,
  streamType: string,
  messages: Message[],
  options?: AppendToStreamOptions & {
    partition?: string;
    beforeCommitHook?: AppendToStreamBeforeCommitHook;
  },
): Promise<AppendToStreamResult> =>
  pool.withTransaction<AppendToStreamResult>(async (transaction) => {
    const { execute } = transaction;

    if (messages.length === 0)
      return { success: false, result: { success: false } };

    try {
      const expectedStreamVersion = toExpectedVersion(
        options?.expectedStreamVersion,
      );

      const messagesToAppend: RecordedMessage[] = messages.map((e) => ({
        ...e,
        kind: e.kind ?? 'Event',
        metadata: {
          messageId: uuid(),
          ...('metadata' in e ? (e.metadata ?? {}) : {}),
        },
      })) as RecordedMessage[];

      const {
        success,
        next_stream_position,
        global_positions,
        transaction_id,
      } = await appendEventsRaw(
        execute,
        streamName,
        streamType,
        messagesToAppend,
        {
          expectedStreamVersion,
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

      globalPositions.forEach((globalPosition, index) => {
        messagesToAppend[index]!.metadata = {
          ...messagesToAppend[index]!.metadata,
          streamName,
          streamPosition:
            nextStreamPosition -
            BigInt(messagesToAppend.length) +
            BigInt(index + 1),
          globalPosition,
        };
      });

      if (options?.beforeCommitHook)
        await options.beforeCommitHook(messagesToAppend, { transaction });

      return {
        success: true,

        result: {
          success: true,
          nextStreamPosition,
          globalPositions,
          transactionId: transaction_id,
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

  // TODO: this needs to be fixed
  if (expected == STREAM_DOES_NOT_EXIST) return null;

  // TODO: this needs to be fixed
  if (expected == STREAM_EXISTS) return null;

  return expected as bigint;
};

const isOptimisticConcurrencyError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === '23505';

type AppendToStreamSqlResult = {
  success: boolean;
  next_stream_position: string | null;
  global_positions: string[] | null;
  transaction_id: string | null | undefined;
};

const appendEventsRaw = (
  execute: SQLExecutor,
  streamId: string,
  streamType: string,
  messages: RecordedMessage[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
  },
): Promise<AppendToStreamSqlResult> =>
  single(
    execute.command<AppendToStreamSqlResult>(
      sql(
        `SELECT * FROM emt_append_to_stream(
                  ARRAY[%s]::text[],
                  ARRAY[%s]::jsonb[],
                  ARRAY[%s]::jsonb[],
                  ARRAY[%s]::text[],
                  ARRAY[%s]::text[],
                  ARRAY[%s]::text[],
                  %L::text,
                  %L::text,
                  %s::bigint,
                  %L::text
              )`,
        messages.map((e) => sql('%L', e.metadata.messageId)).join(','),
        messages.map((e) => sql('%L', JSONParser.stringify(e.data))).join(','),
        messages
          .map((e) => {
            const { messageId: _messageId, ...rawMetadata } = e.metadata;
            return sql('%L', JSONParser.stringify(rawMetadata));
          })
          .join(','),
        messages.map(() => `'1'`).join(','),
        messages.map((e) => sql('%L', e.type)).join(','),
        messages
          .map((e) => sql('%L', e.kind === 'Event' ? 'E' : 'C'))
          .join(','),
        streamId,
        streamType,
        options?.expectedStreamVersion ?? 'NULL',
        options?.partition ?? defaultTag,
      ),
    ),
  );
