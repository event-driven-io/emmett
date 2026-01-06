import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { projectionsTable, unknownTag } from '../../schema';

const acquireSQLOld = `
WITH lock_check AS (
    SELECT pg_try_advisory_xact_lock_shared(
        ('x' || substr(md5(%L), 1, 16))::bit(64)::bigint
    ) AS acquired
),
status_check AS (
    SELECT status = 'active' AS is_active
    FROM ${projectionsTable.name}
    WHERE partition = %L AND name = %L AND version = %s 
)
SELECT
    COALESCE((SELECT acquired FROM lock_check), false) AS acquired,
    COALESCE((SELECT is_active FROM status_check), true) AS is_active;
`;

const acquireSQL = `
WITH lock_check AS (
    SELECT pg_try_advisory_lock(
        ('x' || substr(md5(%L), 1, 16))::bit(64)::bigint
    ) AS acquired
),
ownership_check AS (
    INSERT INTO emt_processors (
        processor_id,
        partition,
        version,
        processor_instance_id,
        status,
        last_processed_checkpoint,
        last_processed_transaction_id
    )
    SELECT %L, %L, %L, %L, 'running', '0', '0'::xid8
    WHERE (SELECT acquired FROM lock_check) = true
    ON CONFLICT (processor_id, partition, version) DO UPDATE
    SET processor_instance_id = %L,
        status = 'running'
    WHERE emt_processors.processor_instance_id = %L
       OR emt_processors.processor_instance_id = '${unknownTag}'
       OR emt_processors.status = 'stopped'
    RETURNING last_processed_checkpoint
)
SELECT
    COALESCE((SELECT acquired FROM lock_check), false) AS acquired,
    (SELECT last_processed_checkpoint FROM ownership_check) AS checkpoint;`;

export const tryAcquireProcessorLock = async (
  execute: SQLExecutor,
  {
    processorid,
    processorInstanceId,
    name,
    partition,
    version,
  }: {
    processorid: string;
    processorInstanceId: string;
    name: string;
    partition: string;
    version: number;
  },
): Promise<boolean> => {
  const { acquired, is_active } = await single(
    execute.query<{
      acquired: boolean;
      is_active: boolean;
    }>(
      sql(
        acquireSQL,
        `${partition}:${name}:${version}`,
        processorid,
        partition,
        version,
        processorInstanceId,
      ),
    ),
  );

  return acquired === true && is_active === true;
};
