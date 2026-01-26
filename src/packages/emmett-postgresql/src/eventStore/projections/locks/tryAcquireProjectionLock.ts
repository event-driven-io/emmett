import { single, type SQLExecutor } from '@event-driven-io/dumbo';
import { hashText, isBigint } from '@event-driven-io/emmett';
import { callTryAcquireProjectionLock } from '../../schema/projections/projectionsLocks';

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
      callTryAcquireProjectionLock({
        lockKey: lockKeyBigInt.toString(),
        partition,
        name: projectionName,
        version,
      }),
    ),
  );

  return acquired === true && is_active === true;
};
