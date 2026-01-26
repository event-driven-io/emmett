import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { hashText, isBigint } from '@event-driven-io/emmett';

export type TryAcquireProjectionLockOptions = {
  projectionName: string;
  partition: string;
  version: number;
  lockKey: string | bigint;
};

export const tryAcquireProjectionLock = async (
  execute: SQLExecutor,
  {
    lockKey,
    projectionName,
    partition,
    version,
  }: TryAcquireProjectionLockOptions,
): Promise<boolean> => {
  const lockKeyBigInt = isBigint(lockKey) ? lockKey : await hashText(lockKey);

  const { acquired, is_active } = await single(
    execute.query<{
      acquired: boolean;
      is_active: boolean;
    }>(
      sql(
        `SELECT * FROM emt_try_acquire_projection_lock(%s::BIGINT, %L, %L, %s);`,
        lockKeyBigInt.toString(),
        partition,
        projectionName,
        version,
      ),
    ),
  );

  return acquired === true && is_active === true;
};
