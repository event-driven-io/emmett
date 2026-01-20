import { SQL } from '@event-driven-io/dumbo';

export const schema_0_42_0 = SQL`
  CREATE TABLE IF NOT EXISTS emt_streams(
      stream_id         TEXT                      NOT NULL,
      stream_position   BIGINT                    NOT NULL,
      partition         TEXT                      NOT NULL DEFAULT 'emt:default',
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
      stream_position        BIGINT                    NOT NULL,
      global_position        BIGINT                    DEFAULT nextval('emt_global_message_position'),
      transaction_id         XID8                      NOT NULL,
      created                TIMESTAMPTZ               NOT NULL DEFAULT now(),
      is_archived            BOOLEAN                   NOT NULL DEFAULT FALSE,
      message_kind           VARCHAR(1)                NOT NULL DEFAULT 'E',
      stream_id              TEXT                      NOT NULL,
      partition              TEXT                      NOT NULL DEFAULT 'emt:default',
      message_schema_version TEXT                      NOT NULL,
      message_id             TEXT                      NOT NULL,
      message_type           TEXT                      NOT NULL,
      message_data           JSONB                     NOT NULL,
      message_metadata       JSONB                     NOT NULL,
      PRIMARY KEY (stream_id, stream_position, partition, is_archived)
  ) PARTITION BY LIST (partition);
  CREATE TABLE IF NOT EXISTS emt_projections(
      version                       INT                    NOT NULL DEFAULT 1,
      type                          VARCHAR(1)             NOT NULL,
      name                          TEXT                   NOT NULL,
      partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
      kind                          TEXT                   NOT NULL,
      status                        TEXT                   NOT NULL,
      definition                    JSONB                  NOT NULL DEFAULT '{}'::jsonb,
      created_at                    TIMESTAMPTZ            NOT NULL DEFAULT now(),
      last_updated                  TIMESTAMPTZ            NOT NULL DEFAULT now(),
      PRIMARY KEY (name, partition, version)
  ) PARTITION BY LIST (partition);

  CREATE TABLE IF NOT EXISTS emt_processors(
      last_processed_transaction_id XID8                   NOT NULL,
      version                       INT                    NOT NULL DEFAULT 1,
      processor_id                  TEXT                   NOT NULL,
      partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
      status                        TEXT                   NOT NULL DEFAULT 'stopped',
      last_processed_checkpoint     TEXT                   NOT NULL,
      processor_instance_id         TEXT                   DEFAULT 'emt:unknown',
      created_at                    TIMESTAMPTZ            NOT NULL DEFAULT now(),
      last_updated                  TIMESTAMPTZ            NOT NULL DEFAULT now(),
      PRIMARY KEY (processor_id, partition, version)
  ) PARTITION BY LIST (partition);

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'emt_sanitize_name') THEN
  CREATE OR REPLACE FUNCTION emt_sanitize_name(input_name TEXT) RETURNS TEXT AS $emt_sanitize_name$
    BEGIN
        RETURN REGEXP_REPLACE(input_name, '[^a-zA-Z0-9_]', '_', 'g');
    END;
    $emt_sanitize_name$ LANGUAGE plpgsql;
END IF;
END $$;

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'emt_add_table_partition') THEN
  
  CREATE OR REPLACE FUNCTION emt_add_table_partition(tableName TEXT, partition_name TEXT) RETURNS void AS $emt_add_table_partition$
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
  $emt_add_table_partition$ LANGUAGE plpgsql;
END IF;
END $$;

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'emt_add_partition') THEN
  
  CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $emt_add_partition$
  BEGIN                
      PERFORM emt_add_table_partition('emt_messages', partition_name);
      PERFORM emt_add_table_partition('emt_streams', partition_name);

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L);',
          emt_sanitize_name('emt_processors' || '_' || partition_name), 'emt_processors', partition_name
      );

      EXECUTE format('
          CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
          FOR VALUES IN (%L);',
          emt_sanitize_name('emt_projections' || '_' || partition_name), 'emt_projections', partition_name
      );
  END;
  $emt_add_partition$ LANGUAGE plpgsql;
END IF;
END $$;

DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'emt_append_to_stream') THEN
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
SELECT emt_add_partition('emt:default');
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'store_processor_checkpoint') THEN
  
CREATE OR REPLACE FUNCTION store_processor_checkpoint(
  p_processor_id           TEXT,
  p_version                BIGINT,
  p_position               TEXT,
  p_check_position         TEXT,
  p_transaction_id         xid8,
  p_partition              TEXT DEFAULT 'emt:default',
  p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
) RETURNS INT AS $spc$
DECLARE
  current_position TEXT;
BEGIN
  -- Handle the case when p_check_position is provided
  IF p_check_position IS NOT NULL THEN
      -- Try to update if the position matches p_check_position
      UPDATE "emt_processors"
      SET 
        "last_processed_checkpoint" = p_position, 
        "last_processed_transaction_id" = p_transaction_id
      WHERE "processor_id" = p_processor_id AND "last_processed_checkpoint" = p_check_position AND "partition" = p_partition;

      IF FOUND THEN
          RETURN 1;  -- Successfully updated
      END IF;

      -- Retrieve the current position
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "emt_processors"
      WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

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
      INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id")
      VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id);
      RETURN 1;  -- Successfully inserted
  EXCEPTION WHEN unique_violation THEN
      -- If insertion failed, it means the row already exists
      SELECT "last_processed_checkpoint" INTO current_position
      FROM "emt_processors"
      WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

      IF current_position = p_position THEN
          RETURN 0;  -- Idempotent check: position already set
      ELSE
          RETURN 2;  -- Insertion failed, row already exists with different position
      END IF;
  END;
END;
$spc$ LANGUAGE plpgsql;

END IF;
END $$;

CREATE OR REPLACE FUNCTION emt_try_acquire_processor_lock(
    p_lock_key               BIGINT,
    p_processor_id           TEXT,
    p_version                INT,
    p_partition              TEXT       DEFAULT 'emt:default',
    p_processor_instance_id  TEXT       DEFAULT 'emt:unknown',
    p_projection_name        TEXT       DEFAULT NULL,
    p_projection_type        VARCHAR(1) DEFAULT NULL,
    p_projection_kind        TEXT       DEFAULT NULL,
    p_lock_timeout_seconds   INT        DEFAULT 300
)
RETURNS TABLE (acquired BOOLEAN, checkpoint TEXT)
LANGUAGE plpgsql
AS $emt_try_acquire_processor_lock$
BEGIN
    RETURN QUERY
    WITH lock_check AS (
        SELECT pg_try_advisory_lock(p_lock_key) AS lock_acquired
    ),
    ownership_check AS (
        INSERT INTO emt_processors (
            processor_id,
            partition,
            version,
            processor_instance_id,
            status,
            last_processed_checkpoint,
            last_processed_transaction_id,
            created_at,
            last_updated
        )
        SELECT p_processor_id, p_partition, p_version, p_processor_instance_id, 'running', '0', '0'::xid8, now(), now()
        WHERE (SELECT lock_acquired FROM lock_check) = true
        ON CONFLICT (processor_id, partition, version) DO UPDATE
        SET processor_instance_id = p_processor_instance_id,
            status = 'running',
            last_updated = now()
        WHERE emt_processors.processor_instance_id = p_processor_instance_id
           OR emt_processors.processor_instance_id = 'emt:unknown'
           OR emt_processors.status = 'stopped'
           OR emt_processors.last_updated < now() - (p_lock_timeout_seconds || ' seconds')::interval
        RETURNING last_processed_checkpoint
    ),
    projection_status AS (
        INSERT INTO emt_projections (
            name,
            partition,
            version,
            type,
            kind,
            status,
            definition
        )
        SELECT p_projection_name, p_partition, p_version, p_projection_type, p_projection_kind, 'rebuilding', '{}'::jsonb
        WHERE p_projection_name IS NOT NULL
          AND (SELECT last_processed_checkpoint FROM ownership_check) IS NOT NULL
        ON CONFLICT (name, partition, version) DO UPDATE
        SET status = 'rebuilding'
        RETURNING name
    )
    SELECT
        (SELECT COUNT(*) > 0 FROM ownership_check),
        (SELECT oc.last_processed_checkpoint FROM ownership_check oc);
END;
$emt_try_acquire_processor_lock$;

CREATE OR REPLACE FUNCTION emt_release_processor_lock(
    p_lock_key              BIGINT,
    p_processor_id          TEXT,
    p_partition             TEXT,
    p_version               INT,
    p_processor_instance_id TEXT DEFAULT 'emt:unknown',
    p_projection_name       TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_release_processor_lock$
BEGIN
    IF p_projection_name IS NOT NULL THEN
        UPDATE emt_projections
        SET status = 'active',
            last_updated = now()
        WHERE partition = p_partition
          AND name = p_projection_name
          AND version = p_version;
    END IF;

    UPDATE emt_processors
    SET status = 'stopped',
        processor_instance_id = 'emt:unknown',
        last_updated = now()
    WHERE processor_id = p_processor_id
      AND partition = p_partition
      AND version = p_version
      AND processor_instance_id = p_processor_instance_id;

    RETURN pg_advisory_unlock(p_lock_key);
END;
$emt_release_processor_lock$;

CREATE OR REPLACE FUNCTION emt_register_projection(
    p_lock_key      BIGINT,
    p_name          TEXT,
    p_partition     TEXT,
    p_version       INT,
    p_type          VARCHAR(1),
    p_kind          TEXT,
    p_status        TEXT,
    p_definition    JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_register_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    upsert_result AS (
        INSERT INTO emt_projections (
            name, partition, version, type, kind, status, definition, created_at, last_updated
        )
        SELECT p_name, p_partition, p_version, p_type, p_kind, p_status, p_definition, now(), now()
        WHERE (SELECT lock_acquired FROM lock_check) = true
        ON CONFLICT (name, partition, version) DO UPDATE
        SET definition = EXCLUDED.definition,
            last_updated = now()
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM upsert_result;

    RETURN v_result;
END;
$emt_register_projection$;

CREATE OR REPLACE FUNCTION emt_activate_projection(
    p_lock_key   BIGINT,
    p_name       TEXT,
    p_partition  TEXT,
    p_version    INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_activate_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    update_result AS (
        UPDATE emt_projections
        SET status = 'active',
            last_updated = now()
        WHERE name = p_name
          AND partition = p_partition
          AND version = p_version
          AND (SELECT lock_acquired FROM lock_check) = true
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM update_result;

    RETURN v_result;
END;
$emt_activate_projection$;

CREATE OR REPLACE FUNCTION emt_deactivate_projection(
    p_lock_key   BIGINT,
    p_name       TEXT,
    p_partition  TEXT,
    p_version    INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_deactivate_projection$
DECLARE
    v_result BOOLEAN;
BEGIN
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
    ),
    update_result AS (
        UPDATE emt_projections
        SET status = 'inactive',
            last_updated = now()
        WHERE name = p_name
          AND partition = p_partition
          AND version = p_version
          AND (SELECT lock_acquired FROM lock_check) = true
        RETURNING name
    )
    SELECT COUNT(*) > 0 INTO v_result FROM update_result;

    RETURN v_result;
END;
$emt_deactivate_projection$;
`;
