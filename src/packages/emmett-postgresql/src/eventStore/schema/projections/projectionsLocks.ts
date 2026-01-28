import { SQL } from '@event-driven-io/dumbo';
import { createFunctionIfDoesNotExistSQL } from '../createFunctionIfDoesNotExist';
import { projectionsTable } from '../typing';

export const tryAcquireProjectionLockSQL = createFunctionIfDoesNotExistSQL(
  'emt_try_acquire_projection_lock',
  SQL`
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
        FROM ${SQL.plain(projectionsTable.name)}
        WHERE partition = p_partition AND name = p_name AND version = p_version
    )
    SELECT
        COALESCE((SELECT lc.acquired FROM lock_check lc), false),
        COALESCE((SELECT sc.is_active FROM status_check sc), true);
END;
$emt_try_acquire_projection_lock$;
`,
);

type CallTryAcquireProjectionLockParams = {
  lockKey: string;
  partition: string;
  name: string;
  version: number;
};

export const callTryAcquireProjectionLock = (
  params: CallTryAcquireProjectionLockParams,
) =>
  SQL`SELECT * FROM emt_try_acquire_projection_lock(${params.lockKey}, ${params.partition}, ${params.name}, ${params.version});`;
