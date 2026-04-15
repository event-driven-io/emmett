import {
  dumbo,
  SQL,
  sqlMigration,
  type SQLMigration,
} from '@event-driven-io/dumbo';

export const migration_0_43_0_cleanupLegacySubscriptionSQL = SQL`
DO $$
BEGIN
IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'emt_subscriptions') THEN
    -- Restore clean emt_add_partition (remove creation of emt_subscriptions partitions)
    CREATE OR REPLACE FUNCTION emt_add_partition(partition_name TEXT) RETURNS void AS $fnpar$
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
    $fnpar$ LANGUAGE plpgsql;

    -- Drop old subscriptions table if it exists
    DROP TABLE IF EXISTS emt_subscriptions CASCADE;

    -- Drop old function if it exists
    DROP FUNCTION IF EXISTS store_subscription_checkpoint(character varying, bigint, bigint, bigint, xid8, text);
    
    -- Restore clean store_processor_checkpoint (remove dual-write logic)
    CREATE OR REPLACE FUNCTION store_processor_checkpoint(
      p_processor_id           TEXT,
      p_version                BIGINT,
      p_position               TEXT,
      p_check_position         TEXT,
      p_transaction_id         xid8,
      p_partition              TEXT DEFAULT 'emt:default',
      p_processor_instance_id  TEXT DEFAULT 'emt:unknown'
    ) RETURNS INT AS $fn$
    DECLARE
      current_position TEXT;
    BEGIN
      IF p_check_position IS NOT NULL THEN
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
              RETURN 1;
          END IF;

          SELECT "last_processed_checkpoint" INTO current_position
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id 
            AND "partition" = p_partition            
            AND "version" = p_version ;

          IF current_position = p_position THEN
              RETURN 0;
          ELSIF current_position > p_position THEN
              RETURN 3;
          ELSE
              RETURN 2;
          END IF;
      END IF;

      BEGIN
          INSERT INTO "emt_processors"("processor_id", "version", "last_processed_checkpoint", "partition", "last_processed_transaction_id", "created_at", "last_updated")
          VALUES (p_processor_id, p_version, p_position, p_partition, p_transaction_id, now(), now());
          RETURN 1;
      EXCEPTION WHEN unique_violation THEN
          SELECT "last_processed_checkpoint" INTO current_position
          FROM "emt_processors"
          WHERE "processor_id" = p_processor_id 
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
END IF;
END $$;
`;

export const migration_0_43_0_cleanupLegacySubscription: SQLMigration =
  sqlMigration('emt:postgresql:eventstore:0.43.0:cleanup-legacy-subscription', [
    migration_0_43_0_cleanupLegacySubscriptionSQL,
  ]);

export const migration_0_43_0_completedStatusSQL = SQL`
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE proname = 'emt_release_processor_lock'
        AND pronargs = 7
    ) THEN
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
           OR emt_processors.status = 'completed'
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
    p_processor_instance_id TEXT,
    p_projection_name       TEXT,
    p_completed             BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_release_processor_lock_7$
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
    SET status = CASE WHEN p_completed THEN 'completed' ELSE 'stopped' END,
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
$emt_release_processor_lock_7$;
    END IF;
END $$;
`;

export const migration_0_43_0_completedStatus: SQLMigration = sqlMigration(
  'emt:postgresql:eventstore:0.43.0:completed-status',
  [migration_0_43_0_completedStatusSQL],
);

export const cleanupLegacySubscriptionTables = async (
  connectionString: string,
) => {
  const pool = dumbo({ connectionString });

  try {
    await pool.withTransaction(async ({ execute }) => {
      await execute.command(migration_0_43_0_cleanupLegacySubscriptionSQL);
    });
  } finally {
    await pool.close();
  }
};
