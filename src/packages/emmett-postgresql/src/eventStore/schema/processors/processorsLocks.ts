import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
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
    p_lock_key               TEXT,
    p_processor_id           TEXT,
    p_version                INT,
    p_partition              TEXT       DEFAULT '${defaultTag}',
    p_processor_instance_id  TEXT       DEFAULT '${unknownTag}',
    p_projection_name        TEXT       DEFAULT NULL,
    p_projection_type        VARCHAR(1) DEFAULT NULL,
    p_projection_kind        TEXT       DEFAULT NULL
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
        COALESCE((SELECT lc.acquired FROM lock_check lc), false) AS acquired,
        (SELECT oc.last_processed_checkpoint FROM ownership_check oc) AS last_processed_checkpoint;
END;
$$ LANGUAGE plpgsql;
`,
);

export const releaseProcessorLock = createFunctionIfDoesNotExistSQL(
  'emt_release_processor_lock',
  `
CREATE OR REPLACE FUNCTION emt_release_processor_lock(
    p_lock_key              TEXT,
    p_processor_id          TEXT,
    p_partition             TEXT,
    p_version               INT,
    p_projection_name       TEXT DEFAULT NULL,
    p_processor_instance_id TEXT DEFAULT '${unknownTag}'
)
RETURNS BOOLEAN
AS $$
BEGIN
    IF p_projection_name IS NOT NULL THEN
        UPDATE ${projectionsTable.name}
        SET status = 'active'
        WHERE partition = p_partition
          AND name = p_projection_name
          AND version = p_version;
    END IF;

    UPDATE ${processorsTable.name}
    SET status = 'stopped',
        processor_instance_id = '${unknownTag}'
    WHERE processor_id = p_processor_id
      AND partition = p_partition
      AND version = p_version
      AND processor_instance_id = p_processor_instance_id;

    RETURN pg_advisory_unlock(
        ('x' || substr(md5(p_lock_key), 1, 16))::bit(64)::bigint
    );
END;
$$ LANGUAGE plpgsql;
`,
);

export type TryAcquireProcessorLockResult =
  | {
      acquired: true;
      checkpoint: string;
    }
  | { acquired: false };

export const tryAcquireProcessorLock = async (
  execute: SQLExecutor,
  options: {
    lockKey: string;
    processorId: string;
    version: number;
    partition?: string;
    processorInstanceId?: string;
    projectionName?: string;
    projectionType?: 'i' | 'a';
    projectionKind?: string;
  },
): Promise<TryAcquireProcessorLockResult> => {
  const { acquired, checkpoint } = await single(
    execute.command<{ acquired: boolean; checkpoint: string | null }>(
      sql(
        `SELECT * FROM emt_try_acquire_processor_lock(%L, %L, %s, %L, %L, %L, %L, %L);`,
        options.lockKey,
        options.processorId,
        options.version,
        options.partition ?? defaultTag,
        options.processorInstanceId ?? unknownTag,
        options.projectionName ?? null,
        options.projectionType ?? null,
        options.projectionKind ?? null,
      ),
    ),
  );

  return acquired
    ? { acquired: true, checkpoint: checkpoint! }
    : { acquired: false };
};

export const releaseProcessorLockFn = async (
  execute: SQLExecutor,
  options: {
    lockKey: string;
    processorId: string;
    partition: string;
    version: number;
    projectionName?: string;
    processorInstanceId?: string;
  },
): Promise<boolean> => {
  const { result } = await single(
    execute.command<{ result: boolean }>(
      sql(
        `SELECT emt_release_processor_lock(%L, %L, %L, %s, %L, %L) as result;`,
        options.lockKey,
        options.processorId,
        options.partition,
        options.version,
        options.projectionName ?? null,
        options.processorInstanceId ?? unknownTag,
      ),
    ),
  );

  return result;
};
