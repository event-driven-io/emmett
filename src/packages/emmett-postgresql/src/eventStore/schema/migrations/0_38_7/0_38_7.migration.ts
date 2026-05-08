import { SQL, type SQLMigration, sqlMigration } from '@event-driven-io/dumbo';

export const dropFutureConceptModuleAndTenantFunctions = SQL`
  DO $$
  BEGIN
      -- Check and drop functions related to future concept of modules and tenants
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_module') THEN
          DROP FUNCTION add_module(TEXT);
      END IF;
      
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_tenant') THEN
          DROP FUNCTION add_tenant(TEXT, TEXT);
      END IF;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_module_for_all_tenants') THEN
          DROP FUNCTION add_module_for_all_tenants(TEXT);
      END IF;
  
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_tenant_for_all_modules') THEN
          DROP FUNCTION add_tenant_for_all_modules(TEXT);
      END IF;
  END $$;
`;

export const dropOldAppendToSQLWithoutGlobalPositions = SQL`
  DO $$
  DECLARE
      v_current_return_type text;
  BEGIN
      -- Get the current return type definition as text
      SELECT pg_get_function_result(p.oid)
      INTO v_current_return_type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = current_schema()  -- or specify your schema
      AND p.proname = 'emt_append_to_stream'
      AND p.pronargs = 10;  -- number of arguments
      
      -- Check if it contains the old column name
      IF v_current_return_type IS NOT NULL AND 
        v_current_return_type LIKE '%last_global_position%' AND 
        v_current_return_type NOT LIKE '%global_positions%' THEN
          DROP FUNCTION emt_append_to_stream(text[], jsonb[], jsonb[], text[], text[], text[], text, text, bigint, text);
          RAISE NOTICE 'Old version of function dropped. Return type was: %', v_current_return_type;

        CREATE OR REPLACE FUNCTION emt_append_to_stream(
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
                    FROM emt_streams
                    WHERE stream_id = v_stream_id 
                    AND partition = v_partition 
                    AND is_archived = FALSE
                    LIMIT 1), 
                    0
                ) INTO v_expected_stream_position;
            END IF;

            v_next_stream_position := v_expected_stream_position + array_upper(v_messages_data, 1);

            IF v_expected_stream_position = 0 THEN
                INSERT INTO emt_streams
                    (stream_id, stream_position, partition, stream_type, stream_metadata, is_archived)
                VALUES
                    (v_stream_id, v_next_stream_position, v_partition, v_stream_type, '{}', FALSE);
            ELSE
                UPDATE emt_streams as s              
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
                INSERT INTO emt_messages
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
      END IF;
  END $$;
`;

export const migrationFromEventsToMessagesSQL = SQL`
DO $$ 
DECLARE
    partition_record RECORD;
BEGIN
    -- Rename the main table and its columns if it exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_events') THEN
        -- Rename all partitions first
        FOR partition_record IN 
            SELECT tablename 
            FROM pg_tables 
            WHERE tablename LIKE 'emt_events_%'
            ORDER BY tablename DESC  -- to handle child partitions first
        LOOP
            EXECUTE format('ALTER TABLE %I RENAME TO %I', 
                partition_record.tablename, 
                REPLACE(partition_record.tablename, 'events', 'messages'));
        END LOOP;

        -- Rename the main table
        ALTER TABLE emt_events RENAME TO emt_messages;
        
        -- Rename columns
        ALTER TABLE emt_messages 
            RENAME COLUMN event_data TO message_data;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_metadata TO message_metadata;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_schema_version TO message_schema_version;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_type TO message_type;
        ALTER TABLE emt_messages 
            RENAME COLUMN event_id TO message_id;
        ALTER TABLE emt_messages 
            ADD COLUMN message_kind CHAR(1) NOT NULL DEFAULT 'E';

        -- Rename sequence if it exists
        IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'emt_global_event_position') THEN
            ALTER SEQUENCE emt_global_event_position 
            RENAME TO emt_global_message_position;
            
            ALTER TABLE emt_messages 
                ALTER COLUMN global_position 
                SET DEFAULT nextval('emt_global_message_position');
        END IF;
    END IF;
END $$;`;

export const migration_0_38_7_and_older: SQLMigration = sqlMigration(
  'emt:postgresql:eventstore:0.38.7:migrate-events-to-messages:with_append_to_stream_update',
  [
    dropFutureConceptModuleAndTenantFunctions,
    dropOldAppendToSQLWithoutGlobalPositions,
    migrationFromEventsToMessagesSQL,
  ],
);
