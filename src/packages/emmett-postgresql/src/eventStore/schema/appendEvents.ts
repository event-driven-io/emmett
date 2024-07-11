import { JSONParser, type Event } from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { executeSQLInTransaction, single } from '../../execute';
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
        v_partition text DEFAULT emt_sanitize_name('${defaultTag}')
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
        current_stream_position bigint;
    BEGIN
        IF v_expected_stream_position IS NULL THEN
            SELECT COALESCE(max(stream_position), 0) INTO current_stream_position
            FROM ${streamsTable.name}
            WHERE stream_id = v_stream_id AND partition = v_partition;
        ELSE
            current_stream_position := v_expected_stream_position;
        END IF;
  
        v_next_stream_position := current_stream_position + array_upper(v_events_data, 1);
        v_transaction_id := pg_current_xact_id();
  
        WITH ev AS (
            SELECT row_number() OVER () + current_stream_position AS stream_position, 
                  event_data, 
                  event_metadata, 
                  schema_version, 
                  event_id, 
                  event_type
            FROM (
                SELECT *
                FROM unnest(v_event_ids, v_events_data, v_events_metadata, v_event_schema_versions, v_event_types) AS event(event_id, event_data, event_metadata, schema_version, event_type)
            ) AS event
        ),
        all_events_insert AS (
            INSERT INTO ${eventsTable.name}
                (stream_id, stream_position, partition, event_data, event_metadata, event_schema_version, event_type, event_id, transaction_id)
            SELECT v_stream_id, ev.stream_position, v_partition, ev.event_data, ev.event_metadata, ev.schema_version, ev.event_type, ev.event_id, v_transaction_id
            FROM ev
            RETURNING global_position
        )
        SELECT max(global_position) INTO v_last_global_position FROM all_events_insert;
  
        INSERT INTO ${streamsTable.name}
              (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
        SELECT v_stream_id, v_next_stream_position, v_partition, v_stream_type, '{}', FALSE
        WHERE NOT EXISTS (
            SELECT 1 FROM ${streamsTable.name} 
            WHERE stream_id = v_stream_id AND partition = v_partition
        )
        ON CONFLICT (stream_id, partition, is_archived) DO UPDATE SET 
            stream_position = v_next_stream_position
            WHERE ${streamsTable.name}.stream_position = current_stream_position;
  
        IF v_expected_stream_position IS NOT NULL THEN
            UPDATE ${streamsTable.name}
            SET stream_position = v_next_stream_position
            WHERE stream_id = v_stream_id AND stream_position = current_stream_position AND partition = v_partition;
  
            GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  
            IF v_updated_rows = 0 THEN
                RETURN QUERY SELECT FALSE, NULL::bigint, NULL::bigint, NULL::xid8;
            END IF;
        END IF;
  
        RETURN QUERY SELECT TRUE, v_next_stream_position, v_last_global_position, v_transaction_id;
    END;
    $$;
  `,
);
type AppendEventResult = {
  success: boolean;
  next_stream_position: bigint | null;
  last_global_position: bigint | null;
  transaction_id: string | null | undefined;
};

export const appendEvent = (
  pool: pg.Pool,
  streamId: string,
  streamType: string,
  events: Event[],
  options: {
    expectedStreamVersion?: bigint;
    partition?: string;
  },
): Promise<AppendEventResult> =>
  single(
    executeSQLInTransaction<AppendEventResult>(
      pool,
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
        options?.expectedStreamVersion ?? null,
        options?.partition ?? defaultTag,
      ),
    ),
  );
