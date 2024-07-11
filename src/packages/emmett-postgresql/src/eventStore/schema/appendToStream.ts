import {
  JSONParser,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AppendToStreamOptions,
  type Event,
  type ExpectedStreamVersion,
} from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { executeInTransaction, executeSQL, single } from '../../execute';
import { rawSQL, sql } from '../../sql';
import { defaultTag, eventsTable, streamsTable } from './typing';

export const appendEventsSQL = rawSQL(
  `CREATE OR REPLACE FUNCTION emt_append_event(
      v_event_ids text[],
      v_events_data jsonb[],
      v_events_metadata jsonb[],
      v_event_schema_versions text[],
      v_event_types text[],
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
                event_data, 
                event_metadata, 
                schema_version, 
                event_id, 
                event_type
          FROM (
              SELECT *
              FROM 
                unnest(v_event_ids, v_events_data, v_events_metadata, v_event_schema_versions, v_event_types) 
              AS event(event_id, event_data, event_metadata, schema_version, event_type)
          ) AS event
      ),
      all_events_insert AS (
          INSERT INTO ${eventsTable.name}
              (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, transaction_id)
          SELECT 
              v_stream_id, ev.stream_position, v_partition, ev.event_data, ev.event_metadata, ev.schema_version, ev.event_type, ev.event_id, v_transaction_id
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

export const appendToStream = (
  pool: pg.Pool,
  streamName: string,
  streamType: string,
  events: Event[],
  options?: AppendToStreamOptions & {
    partition?: string;
  },
): Promise<AppendEventResult> =>
  executeInTransaction<AppendEventResult>(pool, async (client) => {
    if (events.length === 0)
      return { success: false, result: { success: false } };

    let appendResult: AppendEventSqlResult;

    try {
      appendResult = await appendEventsRaw(
        client,
        streamName,
        streamType,
        events,
        {
          expectedStreamVersion: toExpectedVersion(
            options?.expectedStreamVersion,
          ),
        },
      );
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
  client: pg.PoolClient,
  streamId: string,
  streamType: string,
  events: Event[],
  options?: {
    expectedStreamVersion: bigint | null;
    partition?: string;
  },
): Promise<AppendEventSqlResult> =>
  single(
    executeSQL<AppendEventSqlResult>(
      client,
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
        events.map(() => sql('%L', uuid())).join(','),
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
