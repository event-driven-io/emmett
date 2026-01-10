import { createFunctionIfDoesNotExistSQL } from '../createFunctionIfDoesNotExist';
import {
  defaultTag,
  processorsTable,
  projectionsTable,
  unknownTag,
} from '../typing';

export const tryAcquireProcessorLockSQL = createFunctionIfDoesNotExistSQL(
  'emt_try_acquire_processor_lock',
  `
CREATE OR REPLACE FUNCTION emt_try_acquire_processor_lock(
    p_lock_key               BIGINT,
    p_processor_id           TEXT,
    p_version                INT,
    p_partition              TEXT       DEFAULT '${defaultTag}',
    p_processor_instance_id  TEXT       DEFAULT '${unknownTag}',
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
        INSERT INTO ${processorsTable.name} (
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
        WHERE ${processorsTable.name}.processor_instance_id = p_processor_instance_id
           OR ${processorsTable.name}.processor_instance_id = '${unknownTag}'
           OR ${processorsTable.name}.status = 'stopped'
           OR ${processorsTable.name}.last_updated < now() - (p_lock_timeout_seconds || ' seconds')::interval
        RETURNING last_processed_checkpoint
    ),
    projection_status AS (
        INSERT INTO ${projectionsTable.name} (
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
`,
);

export const releaseProcessorLockSQL = createFunctionIfDoesNotExistSQL(
  'emt_release_processor_lock',
  `
CREATE OR REPLACE FUNCTION emt_release_processor_lock(
    p_lock_key              BIGINT,
    p_processor_id          TEXT,
    p_partition             TEXT,
    p_version               INT,
    p_processor_instance_id TEXT DEFAULT '${unknownTag}',
    p_projection_name       TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $emt_release_processor_lock$
BEGIN
    IF p_projection_name IS NOT NULL THEN
        UPDATE ${projectionsTable.name}
        SET status = 'active',
            last_updated = now()
        WHERE partition = p_partition
          AND name = p_projection_name
          AND version = p_version;
    END IF;

    UPDATE ${processorsTable.name}
    SET status = 'stopped',
        processor_instance_id = '${unknownTag}',
        last_updated = now()
    WHERE processor_id = p_processor_id
      AND partition = p_partition
      AND version = p_version
      AND processor_instance_id = p_processor_instance_id;

    RETURN pg_advisory_unlock(p_lock_key);
END;
$emt_release_processor_lock$;
`,
);
