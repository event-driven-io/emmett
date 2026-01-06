import { createFunctionIfDoesNotExistSQL } from './createFunctionIfDoesNotExist';
import { defaultTag, processorsTable, unknownTag } from './typing';

export const storeSubscriptionCheckpointSQL = createFunctionIfDoesNotExistSQL(
  'emt_try_acquire_rebuild_lock',
  `
CREATE OR REPLACE FUNCTION emt_try_acquire_rebuild_lock(
    p_lock_key               TEXT,
    p_processor_id           TEXT,
    p_version                INT,
    p_projection_name        TEXT,
    p_projection_type        VARCHAR(1),
    p_projection_kind        TEXT,
    p_partition              TEXT DEFAULT '${defaultTag}',
    p_processor_instance_id  TEXT DEFAULT '${unknownTag}'
)
RETURNS TABLE (acquired BOOLEAN, checkpoint TEXT)
AS $$
BEGIN
    RETURN QUERY
    WITH lock_check AS (
        SELECT pg_try_advisory_lock(
            ('x' || substr(md5(p_lock_key), 1, 16))::bit(64)::bigint
        ) AS acquired
    ),
    ownership_check AS (
        INSERT INTO ${processorsTable.name} (
            processor_id,
            partition,
            version,
            processor_instance_id,
            status,
            last_processed_checkpoint,
            last_processed_transaction_id
        )
        SELECT p_processor_id, p_partition, p_version, p_processor_instance_id, 'running', '0', '0'::xid8
        WHERE (SELECT acquired FROM lock_check) = true
        ON CONFLICT (processor_id, partition, version) DO UPDATE
        SET processor_instance_id = p_processor_instance_id,
            status = 'running'
        WHERE ${processorsTable.name}.processor_instance_id = p_processor_instance_id
           OR ${processorsTable.name}.processor_instance_id = '${unknownTag}'
           OR ${processorsTable.name}.status = 'stopped'
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
        WHERE (SELECT last_processed_checkpoint FROM ownership_check) IS NOT NULL
        ON CONFLICT (name, partition, version) DO UPDATE
        SET status = 'rebuilding'
        RETURNING name
    )
    SELECT
        COALESCE((SELECT lc.acquired FROM lock_check lc), false),
        (SELECT oc.last_processed_checkpoint FROM ownership_check oc);
END;
$$ LANGUAGE plpgsql;
`,
);
