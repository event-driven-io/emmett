import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { defaultTag } from '../../typing';

export const migration_0_42_0_FromSubscriptionsToProcessorsSQL = SQL`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
        -- 1. Alter message_kind type from CHAR(1) to VARCHAR(1)
        ALTER TABLE emt_messages ALTER COLUMN message_kind TYPE VARCHAR(1);

        -- 2. Setup emt_processors table if not exists
        CREATE TABLE IF NOT EXISTS "emt_processors"(
              last_processed_transaction_id XID8                   NOT NULL,
              version                       INT                    NOT NULL DEFAULT 1,
              processor_id                  TEXT                   NOT NULL,
              partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
              status                        TEXT                   NOT NULL DEFAULT 'stopped', 
              last_processed_checkpoint     TEXT                   NOT NULL,    
              processor_instance_id         TEXT                   DEFAULT 'emt:unknown',
              PRIMARY KEY (processor_id, partition, version)
          ) PARTITION BY LIST (partition);

        -- 3. Setup emt_projections table if not exists

        CREATE TABLE IF NOT EXISTS "emt_projections"(
            version                       INT                    NOT NULL DEFAULT 1,  
            type                          VARCHAR(1)             NOT NULL,
            name                          TEXT                   NOT NULL,
            partition                     TEXT                   NOT NULL DEFAULT 'emt:default',
            kind                          TEXT                   NOT NULL, 
            status                        TEXT                   NOT NULL, 
            definition                    JSONB                  NOT NULL DEFAULT '{}'::jsonb, 
            PRIMARY KEY (name, partition, version)
        ) PARTITION BY LIST (partition);

        CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $fnpar$
        BEGIN                
            PERFORM emt_add_table_partition('emt_messages', partition_name);
            PERFORM emt_add_table_partition('emt_streams', partition_name);
        
            EXECUTE format('
                CREATE TABLE IF NOT EXISTS %I PARTITION OF %I
                FOR VALUES IN (%L);',
                emt_sanitize_name('emt_subscriptions' || '_' || partition_name), 'emt_subscriptions', partition_name
            );

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
        $fnpar$ LANGUAGE plpgsql;

        PERFORM emt_add_partition('${SQL.plain(defaultTag)}');

        -- 3. Copy data from old table to new table
        INSERT INTO "emt_processors"
        (
            processor_id,
            version,
            partition,
            last_processed_checkpoint,
            last_processed_transaction_id,
            status,
            processor_instance_id
        )
        SELECT 
            subscription_id, 
            version,
            partition,
            lpad(last_processed_position::text, 19, '0'),
            last_processed_transaction_id, 'stopped', 
            'emt:unknown'
        FROM emt_subscriptions
        ON CONFLICT DO NOTHING;

        -- 4. Create backward-compat store_subscription_checkpoint that dual-writes
        
        CREATE OR REPLACE FUNCTION store_subscription_checkpoint(
          p_subscription_id VARCHAR(100),
          p_version BIGINT,
          p_position BIGINT,
          p_check_position BIGINT,
          p_transaction_id xid8,
          p_partition TEXT DEFAULT 'emt:default'
        ) RETURNS INT AS $fn$
        DECLARE
          current_position BIGINT;
          result INT;
        BEGIN
          -- Handle the case when p_check_position is provided
          IF p_check_position IS NOT NULL THEN
              -- Try to update if the position matches p_check_position
              UPDATE "emt_subscriptions"
              SET
                "last_processed_position" = p_position,
                "last_processed_transaction_id" = p_transaction_id
              WHERE "subscription_id" = p_subscription_id 
                AND "last_processed_position" = p_check_position 
                AND "partition" = p_partition 
                AND "version" = p_version;

              IF FOUND THEN
                  -- Dual-write to emt_processors
                  UPDATE "emt_processors"
                  SET
                    "last_processed_checkpoint" = lpad(p_position::text, 19, '0'),
                    "last_processed_transaction_id" = p_transaction_id
                  WHERE "processor_id" = p_subscription_id 
                    AND "partition" = p_partition 
                    AND "version" = p_version;

                  IF NOT FOUND THEN
                      INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "status", "processor_instance_id")
                      VALUES (p_subscription_id, p_version, lpad(p_position::text, 19, '0'), p_partition, p_transaction_id, 'stopped', 'emt:unknown')
                      ON CONFLICT DO NOTHING;
                  END IF;

                  RETURN 1;
              END IF;

              -- Retrieve the current position
              SELECT "last_processed_position" INTO current_position
              FROM "emt_subscriptions"
              WHERE "subscription_id" = p_subscription_id AND "partition" = p_partition AND "version" = p_version;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSIF current_position > p_check_position THEN
                  RETURN 2;
              ELSE
                  RETURN 2;
              END IF;
          END IF;

          -- Handle the case when p_check_position is NULL: Insert if not exists
          BEGIN
              INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
              VALUES (p_subscription_id, p_version, p_position, p_partition, p_transaction_id);

              -- Dual-write to emt_processors
              INSERT INTO emt_processors("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "status", "processor_instance_id")
              VALUES (p_subscription_id, p_version, lpad(p_position::text, 19, '0'), p_partition, p_transaction_id, 'stopped', 'emt:unknown')
              ON CONFLICT DO NOTHING;

              RETURN 1;
          EXCEPTION WHEN unique_violation THEN
              SELECT "last_processed_position" INTO current_position
              FROM "emt_subscriptions"
              WHERE "subscription_id" = p_subscription_id 
                AND "partition" = p_partition 
                AND "version" = p_version;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSE
                  RETURN 2;
              END IF;
          END;
        END;
        $fn$ LANGUAGE plpgsql;

        -- 5. Replace store_processor_checkpoint with dual-write version
        CREATE OR REPLACE FUNCTION store_processor_checkpoint(
          p_processor_id           TEXT,
          p_version                BIGINT,
          p_position               TEXT,
          p_check_position         TEXT,
          p_transaction_id         xid8,
          p_partition              TEXT DEFAULT '${SQL.plain(defaultTag)}',
          p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
        ) RETURNS INT AS $fn2$
        DECLARE
          current_position TEXT;
          v_position_bigint BIGINT;
        BEGIN
          -- Convert TEXT position to BIGINT for emt_subscriptions
          v_position_bigint := p_position::BIGINT;

          -- Handle the case when p_check_position is provided
          IF p_check_position IS NOT NULL THEN
              -- Try to update if the position matches p_check_position
              UPDATE "emt_processors"
              SET
                "last_processed_checkpoint" = p_position,
                "last_processed_transaction_id" = p_transaction_id,
                "last_updated" = now()
              WHERE "processor_id" = p_processor_id 
                AND "last_processed_checkpoint" = p_check_position 
                AND "partition" = p_partition 
                AND "version" = p_version;

              IF FOUND THEN
                  -- Dual-write to emt_subscriptions
                  UPDATE "emt_subscriptions"
                  SET
                    "last_processed_position" = v_position_bigint,
                    "last_processed_transaction_id" = p_transaction_id
                  WHERE "subscription_id" = p_processor_id AND "partition" = p_partition AND "version" = p_version;

                  IF NOT FOUND THEN
                      INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
                      VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
                      ON CONFLICT DO NOTHING;
                  END IF;

                  RETURN 1;
              END IF;

              -- Retrieve the current position
              SELECT "last_processed_checkpoint" INTO current_position
              FROM "emt_processors"
              WHERE "processor_id" = p_processor_id AND "partition" = p_partition AND "version" = p_version;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSIF current_position > p_position THEN
                  RETURN 3;
              ELSE
                  RETURN 2;
              END IF;
          END IF;

          -- Handle the case when p_check_position is NULL: Insert if not exists
          BEGIN
              INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
              VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());

              -- Dual-write to emt_subscriptions
              INSERT INTO "emt_subscriptions"("subscription_id", "version", "last_processed_position", "partition", "last_processed_transaction_id")
              VALUES (p_processor_id, p_version, v_position_bigint, p_partition, p_transaction_id)
              ON CONFLICT DO NOTHING;

              RETURN 1;
          EXCEPTION WHEN unique_violation THEN
              SELECT "last_processed_checkpoint" INTO current_position
              FROM "emt_processors"
              WHERE "processor_id" = p_processor_id AND "partition" = p_partition;

              IF current_position = p_position THEN
                  RETURN 0;
              ELSIF current_position > p_position THEN
                  RETURN 3;  -- Current ahead: another process has progressed further
              ELSE
                  RETURN 2;
              END IF;
          END;
        END;
        $fn2$ LANGUAGE plpgsql;
    END IF;
END $$;
`;

export const migration_0_42_0_FromSubscriptionsToProcessors: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.42.0:from-subscriptions-to-processors',
    [migration_0_42_0_FromSubscriptionsToProcessorsSQL],
  );

export const migration_0_42_0_2_AddProcessorProjectionFunctionsSQL = SQL`
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'emt_processors'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'emt_processors' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE emt_processors ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'emt_processors'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'emt_processors' AND column_name = 'last_updated'
    ) THEN
        ALTER TABLE emt_processors ADD COLUMN last_updated TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'emt_projections'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'emt_projections' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE emt_projections ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'emt_projections'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'emt_projections' AND column_name = 'last_updated'
    ) THEN
        ALTER TABLE emt_projections ADD COLUMN last_updated TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION emt_try_acquire_processor_lock(
    p_lock_key               BIGINT,
    p_processor_id           TEXT,
    p_version                INT,
    p_partition              TEXT       DEFAULT '${SQL.plain(defaultTag)}',
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
        SELECT pg_try_advisory_xact_lock(p_lock_key) AS lock_acquired
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
        SELECT p_processor_id, p_partition, p_version, p_processor_instance_id, 'running', '0000000000000000000', '0'::xid8, now(), now()
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
        SELECT p_projection_name, p_partition, p_version, p_projection_type, p_projection_kind, 'async_processing', '{}'::jsonb
        WHERE p_projection_name IS NOT NULL
          AND (SELECT last_processed_checkpoint FROM ownership_check) IS NOT NULL
        ON CONFLICT (name, partition, version) DO UPDATE
        SET status = 'async_processing'
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
DECLARE
    v_rows_updated INT;
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

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    PERFORM pg_advisory_unlock(p_lock_key);

    RETURN v_rows_updated > 0;
END;
$emt_release_processor_lock$;

CREATE OR REPLACE FUNCTION emt_try_acquire_projection_lock(
    p_lock_key   BIGINT,
    p_partition  TEXT,
    p_name       TEXT,
    p_version    INT
)
RETURNS TABLE (acquired BOOLEAN, is_active BOOLEAN)
LANGUAGE plpgsql
AS $emt_try_acquire_projection_lock$
BEGIN
    RETURN QUERY
    WITH lock_check AS (
        SELECT pg_try_advisory_xact_lock_shared(p_lock_key) AS acquired
    ),
    status_check AS (
        SELECT status = 'active' AS is_active
        FROM emt_projections
        WHERE partition = p_partition AND name = p_name AND version = p_version
    )
    SELECT
        COALESCE((SELECT lc.acquired FROM lock_check lc), false),
        COALESCE((SELECT sc.is_active FROM status_check sc), true);
END;
$emt_try_acquire_projection_lock$;

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

export const migration_0_42_0_2_AddProcessorProjectionFunctions: SQLMigration =
  sqlMigration(
    'emt:postgresql:eventstore:0.42.0-2:add-processor-projection-functions',
    [migration_0_42_0_2_AddProcessorProjectionFunctionsSQL],
  );
