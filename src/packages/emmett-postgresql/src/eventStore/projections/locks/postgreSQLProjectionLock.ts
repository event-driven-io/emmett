import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  toProjectionLockKey,
  tryAcquireProjectionLock,
  type TryAcquireProjectionLockOptions,
} from './tryAcquireProjectionLock';

export type PostgreSQLProjectionLockOptions = TryAcquireProjectionLockOptions;

export type PostgreSQLProjectionLockContext = {
  execute: SQLExecutor;
};

export type PostgreSQLProjectionLock = {
  tryAcquire: (options: PostgreSQLProjectionLockContext) => Promise<boolean>;
  release: (options: PostgreSQLProjectionLockContext) => void;
};

export const postgreSQLProjectionLock = (
  options: PostgreSQLProjectionLockOptions,
): PostgreSQLProjectionLock => {
  let acquired = false;
  const lockKey = toProjectionLockKey(options);

  return {
    tryAcquire: async (
      context: PostgreSQLProjectionLockContext,
    ): Promise<boolean> => {
      if (acquired) {
        return true;
      }

      acquired = await tryAcquireProjectionLock(context.execute, {
        ...options,
        lockKey,
      });

      return acquired;
    },

    release: (_context: PostgreSQLProjectionLockContext): void => {
      if (!acquired) return;

      acquired = false;
    },
  };
};
