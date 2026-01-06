import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { hashText, isBigint } from '@event-driven-io/emmett';
import { projectionsTable } from '../../schema';

const acquireSQL = `
WITH lock_check AS (
    SELECT pg_try_advisory_xact_lock_shared(%s::BIGINT) AS acquired
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

export const tryAcquireProjectionLock = async (
  execute: SQLExecutor,
  {
    lockKey,
    projectionName,
    partition,
    version,
  }: {
    projectionName: string;
    partition: string;
    version: number;
    lockKey?: string | bigint;
  },
): Promise<boolean> => {
  lockKey ??= `${partition}:${projectionName}:${version}`;

  const lockKeyBigInt = isBigint(lockKey) ? lockKey : await hashText(lockKey);

  const { acquired, is_active } = await single(
    execute.query<{
      acquired: boolean;
      is_active: boolean;
    }>(
      sql(
        acquireSQL,
        lockKeyBigInt.toString(),
        partition,
        projectionName,
        version,
      ),
    ),
  );

  return acquired === true && is_active === true;
};
