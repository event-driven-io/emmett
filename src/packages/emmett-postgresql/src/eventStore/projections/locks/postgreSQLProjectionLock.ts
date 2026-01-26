import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  tryAcquireProjectionLock,
  type TryAcquireProjectionLockOptions,
} from './tryAcquireProjectionLock';

export type PostgreSQLProjectionLockOptions = {
  projectionName: string;
  partition: string;
  version: number;
  lockKey?: string | bigint;
};

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
  const lockKey = options.lockKey ?? toProjectionLockKey(options);

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

export const toProjectionLockKey = ({
  projectionName,
  partition,
  version,
}: Pick<
  TryAcquireProjectionLockOptions,
  'projectionName' | 'partition' | 'version'
>): string => `${partition}:${projectionName}:${version}`;
