import {
  rawSql,
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
  type Event,
  type ExpectedStreamVersion,
  type ReadEvent,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { defaultTag, messagesTable, streamsTable } from './typing';

export const appendEventsSQL = rawSql(
  `CREATE OR REPLACE FUNCTION emt_append_event(
      v_message_ids text[],
      v_events_data jsonb[],
      v_events_metadata jsonb[],
      v_message_schema_versions text[],
      v_message_types text[],
      v_stream_id text,
      v_stream_type text,
      v_expected_stream_position bigint DEFAULT NULL,
      v_partition text DEFAULT emt_sanitize_name('default_partition')
  ) RETURNS TABLE (
      success boolean,
      next_stream_position bigint,
      last_global_position bigint,
      transaction_id xid8
  ) LANGUAGE plpgsql
  AS $$
  DECLARE
      v_next_stream_position bigint;
      v_position bigint;
      v_updated_rows int;
      v_transaction_id xid8;
      v_last_global_position bigint;
  BEGIN
      IF v_expected_stream_position IS NULL THEN
          SELECT COALESCE(max(stream_position), 0) INTO v_expected_stream_position
          FROM ${streamsTable.name}
          WHERE stream_id = v_stream_id AND partition = v_partition;
      END IF;

      v_next_stream_position := v_expected_stream_position + array_upper(v_events_data, 1);
      v_transaction_id := pg_current_xact_id();

      WITH ev AS (
          SELECT row_number() OVER () + v_expected_stream_position AS stream_position, 
                message_data, 
                message_metadata, 
                schema_version, 
                message_id, 
                message_type
          FROM (
              SELECT *
              FROM 
                unnest(v_message_ids, v_events_data, v_events_metadata, v_message_schema_versions, v_message_types) 
              AS event(message_id, message_data, message_metadata, schema_version, message_type)
          ) AS event
      ),
      all_events_insert AS (
          INSERT INTO ${messagesTable.name}
              (stream_id, stream_position, partition, message_data, message_metadata, message_schema_version, message_type, message_id, transaction_id)
          SELECT 
              v_stream_id, ev.stream_position, v_partition, ev.message_data, ev.message_metadata, ev.schema_version, ev.message_type, ev.message_id, v_transaction_id
          FROM ev
          RETURNING global_position
      )
      SELECT 
          max(global_position) INTO v_last_global_position 
      FROM 
          all_events_insert;


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
              RETURN QUERY SELECT FALSE, NULL::bigint, NULL::bigint, NULL::xid8;
              RETURN;
          END IF;
      END IF;

      RETURN QUERY SELECT TRUE, v_next_stream_position, v_last_global_position, v_transaction_id;
  END;
  $$;
  `,
);

type AppendEventResult =
  | {
      success: true;
      nextStreamPosition: bigint;
      lastGlobalPosition: bigint;
      transactionId: string;
    }
  | { success: false };

export type AppendToStreamPreCommitHook = (
  events: ReadEvent[],
  context: {
    transaction: NodePostgresTransaction;
  },
) => Promise<void>;

export const appendToStream = (
  pool: NodePostgresPool,
  streamName: string,
  streamType: string,
  events: Event[],
  options?: AppendToStreamOptions & {
    partition?: string;
    preCommitHook?: AppendToStreamPreCommitHook;
  },
): Promise<AppendEventResult> =>
  pool.withTransaction<AppendEventResult>(async (transaction) => {
    const { execute } = transaction;

    if (events.length === 0)
      return { success: false, result: { success: false } };

    let appendResult: AppendEventSqlResult;

    try {
      const expectedStreamVersion = toExpectedVersion(
        options?.expectedStreamVersion,
      );

      const eventsToAppend: ReadEvent[] = events.map((e, i) => ({
        ...e,
        kind: e.kind ?? 'Event',
        metadata: {
          streamName,
          messageId: uuid(),
          streamPosition: BigInt(i),
          ...('metadata' in e ? (e.metadata ?? {}) : {}),
        },
      }));

      // TODO: return global positions from append raw and other generated data
      appendResult = await appendEventsRaw(
        execute,
        streamName,
        streamType,
        eventsToAppend,
        {
          expectedStreamVersion,
        },
      );

      if (options?.preCommitHook)
        await options.preCommitHook(eventsToAppend, { transaction });
    } catch (error) {
      if (!isOptimisticConcurrencyError(error)) throw error;

      appendResult = {
        success: false,
        last_global_position: null,
        next_stream_position: null,
        transaction_id: null,
      };
    }

    const {
      success,
      next_stream_position,
      last_global_position,
      transaction_id,
    } = appendResult;

    return {
      success,
      result:
        success &&
        next_stream_position &&
        last_global_position &&
        transaction_id
          ? {
              success: true,
              nextStreamPosition: BigInt(next_stream_position),
              lastGlobalPosition: BigInt(last_global_position),
              transactionId: transaction_id,
            }
          : { success: false },
    };
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

type AppendEventSqlResult = {
  success: boolean;
  next_stream_position: string | null;
  last_global_position: string | null;
  transaction_id: string | null | undefined;
};

const appendEventsRaw = (
  execute: SQLExecutor,
  streamId: string,
  streamType: string,
  events: ReadEvent[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
  },
): Promise<AppendEventSqlResult> =>
  single(
    execute.command<AppendEventSqlResult>(
      sql(
        `SELECT * FROM emt_append_event(
                  ARRAY[%s]::text[],
                  ARRAY[%s]::jsonb[],
                  ARRAY[%s]::jsonb[],
                  ARRAY[%s]::text[],
                  ARRAY[%s]::text[],
                  %L::text,
                  %L::text,
                  %s::bigint,
                  %L::text
              )`,
        events.map((e) => sql('%L', e.metadata.messageId)).join(','),
        events.map((e) => sql('%L', JSONParser.stringify(e.data))).join(','),
        events
          .map((e) => sql('%L', JSONParser.stringify(e.metadata ?? {})))
          .join(','),
        events.map(() => `'1'`).join(','),
        events.map((e) => sql('%L', e.type)).join(','),
        streamId,
        streamType,
        options?.expectedStreamVersion ?? 'NULL',
        options?.partition ?? defaultTag,
      ),
    ),
  );
