import { SQL } from '@event-driven-io/dumbo';

export const schema_0_38_7 = SQL`
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
END $$;CREATE TABLE IF NOT EXISTS emt_streams(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT 'global',
      stream_type       TEXT                      NOT NULL,
      stream_metadata   JSONB                     NOT NULL,
      is_archived       BOOLEAN                   NOT NULL DEFAULT FALSE,
      PRIMARY KEY (stream_id, partition, is_archived)
  ) PARTITION BY LIST (partition);
   
  CREATE UNIQUE INDEX IF NOT EXISTS idx_streams_unique 
  ON emt_streams(stream_id, partition, is_archived) 
  INCLUDE (stream_position);
  CREATE SEQUENCE IF NOT EXISTS emt_global_message_position;

  CREATE TABLE IF NOT EXISTS emt_messages(
      stream_id              TEXT                      NOT NULL,
      stream_position        BIGINT                    NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT 'global',
      message_kind           CHAR(1)                   NOT NULL DEFAULT 'E',
      message_data           JSONB                     NOT NULL,
      message_metadata       JSONB                     NOT NULL,
      message_schema_version TEXT                      NOT NULL,
      message_type           TEXT                      NOT NULL,
      message_id             TEXT                      NOT NULL,
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      global_position        BIGINT                    DEFAULT nextval('emt_global_message_position'),
      transaction_id         XID8                      NOT NULL,
      created                TIMESTAMPTZ               NOT NULL DEFAULT now(),
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ) PARTITION BY LIST (partition);
  CREATE TABLE IF NOT EXISTS emt_subscriptions(
      subscription_id                 TEXT                   NOT NULL,
      version                         INT                    NOT NULL DEFAULT 1,
      partition                       TEXT                   NOT NULL DEFAULT 'global',
      last_processed_position         BIGINT                 NOT NULL,
      last_processed_transaction_id   XID8                   NOT NULL,
      PRIMARY KEY (subscription_id, partition, version)
  ) PARTITION BY LIST (partition);
CREATE OR REPLACE FUNCTION emt_sanitize_name(input_name TEXT) RETURNS TEXT AS $$
    BEGIN
        RETURN REGEXP_REPLACE(input_name, '[^a-zA-Z0-9_]', '_', 'g');
    END;
    $$ LANGUAGE plpgsql;
  CREATE OR REPLACE FUNCTION emt_add_table_partition(tableName TEXT, partition_name TEXT) RETURNS void AS $$
  DECLARE
    v_main_partiton_name     TEXT;
    v_active_partiton_name   TEXT;
    v_archived_partiton_name TEXT;
  BEGIN                
      v_main_partiton_name     := emt_sanitize_name(tableName || '_' || partition_name);
      v_active_partiton_name   := emt_sanitize_name(v_main_partiton_name   || '_active');
      v_archived_partiton_name := emt_sanitize_name(v_main_partiton_name   || '_archived');


      -- create default partition
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L) PARTITION BY LIST (is_archived);',
          v_main_partiton_name, tableName, partition_name
      );
  
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (FALSE);',
          v_active_partiton_name, v_main_partiton_name
      );
  
      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (TRUE);',
          v_archived_partiton_name, v_main_partiton_name
      );
  END;
  $$ LANGUAGE plpgsql;
  CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $$
  BEGIN                
      PERFORM emt_add_table_partition('emt_messages', partition_name);
      PERFORM emt_add_table_partition('emt_streams', partition_name);

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L);',
          emt_sanitize_name('emt_subscriptions' || '_' || partition_name), 'emt_subscriptions', partition_name
      );
  END;
  $$ LANGUAGE plpgsql;
  DROP FUNCTION IF EXISTS add_module(TEXT);
  DROP FUNCTION IF EXISTS add_tenant(TEXT, TEXT);
  DROP FUNCTION IF EXISTS add_module_for_all_tenants(TEXT);
  DROP FUNCTION IF EXISTS add_tenant_for_all_modules(TEXT);

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
      END IF;
  END $$;
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
  AS $$
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
  $$;
  SELECT emt_add_partition('emt:default');
CREATE OR REPLACE FUNCTION store_subscription_checkpoint(
  p_subscription_id VARCHAR(100),
  p_version BIGINT,
  p_position BIGINT,
  p_check_position BIGINT,
  p_transaction_id xid8,
  p_partition TEXT DEFAULT 'emt:default'
) RETURNS INT AS $$
DECLARE
  current_position BIGINT;
BEGIN
  -- Handle the case when p_check_position is provided
  IF p_check_position IS NOT NULL THEN
      -- Try to update if the position matches p_check_position
      UPDATE "emt_subscriptions"
      SET 
        "last_processed_position" = p_position, 
        "last_processed_transaction_id" = p_transaction_id
      WHERE "subscription_id" = p_subscription_id AND "last_processed_position" = p_check_position AND "partition" = p_partition;

      IF FOUND THEN
          RETURN 1;  -- Successfully updated
      END IF;

      -- Retrieve the current position
      SELECT "last_processed_position" INTO current_position
      FROM "emt_subscriptions"
      WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

      -- Return appropriate codes based on current position
      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSIF current_position > p_check_position THEN
          RETURN 2;  -- Failure: current position is greater
      ELSE
          RETURN 2;  -- Default failure case for mismatched positions
      END IF;
  END IF;

  -- Handle the case when p_check_position is NULL: Insert if not exists
  BEGIN
      INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
      VALUES (p_subscription_id, p_version, p_position, p_partition, p_transaction_id);
      RETURN 1;  -- Successfully inserted
  EXCEPTION WHEN unique_violation THEN
      -- If insertion failed, it means the row already exists
      SELECT "last_processed_position" INTO current_position
      FROM "emt_subscriptions"
      WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition;

      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSE
          RETURN 2;  -- Insertion failed, row already exists with different position
      END IF;
  END;
END;
$$ LANGUAGE plpgsql;
`;
