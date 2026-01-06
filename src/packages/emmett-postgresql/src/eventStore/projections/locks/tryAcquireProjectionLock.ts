import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { projectionsTable } from '../../schema';

const acquireSQL = `
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

export const tryAcquireProjectionLock = async (
  execute: SQLExecutor,
  {
    name,
    partition,
    version,
  }: { name: string; partition: string; version: number },
): Promise<boolean> => {
  const { acquired, is_active } = await single(
    execute.query<{
      acquired: boolean;
      is_active: boolean;
    }>(
      sql(
        acquireSQL,
        `${partition}:${name}:${version}`,
        partition,
        name,
        version,
      ),
    ),
  );

  return acquired === true && is_active === true;
};
