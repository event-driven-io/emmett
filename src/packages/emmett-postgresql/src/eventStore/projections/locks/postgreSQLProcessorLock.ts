import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  EmmettError,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import { toProjectionLockKey } from './postgreSQLProjectionLock';
import {
  releaseProcessorLock,
  tryAcquireProcessorLockWithRetry,
  type LockAcquisitionPolicy,
  type TryAcquireProcessorLockOptions,
} from './tryAcquireProcessorLock';

export type PostgreSQLProcessorLockOptions = {
  processorId: string;
  version: number;
  partition: string;
  processorInstanceId: string;
  projection?: {
    name: string;
    handlingType: ProjectionHandlingType;
    kind: string;
    version: number;
  };
  lockKey?: string | bigint;
  lockTimeoutSeconds?: number;
  lockAcquisitionPolicy?: LockAcquisitionPolicy;
};

export type PostgreSQLProcessorLockContext = {
  execute: SQLExecutor;
};

export type PostgreSQLProcessorLock = {
  tryAcquire: (options: PostgreSQLProcessorLockContext) => Promise<boolean>;
  release: (options: PostgreSQLProcessorLockContext) => Promise<void>;
};

export const DefaultPostgreSQLProcessorLockPolicy: LockAcquisitionPolicy = {
  type: 'fail',
};

export const postgreSQLProcessorLock = (
  options: PostgreSQLProcessorLockOptions,
): PostgreSQLProcessorLock => {
  let acquired = false;
  const lockKey = options.lockKey ?? toProcessorLockKey(options);

  return {
    tryAcquire: async (
      context: PostgreSQLProcessorLockContext,
    ): Promise<boolean> => {
      if (acquired) {
        return true;
      }

      const result = await tryAcquireProcessorLockWithRetry(context.execute, {
        ...options,
        lockKey,
      });

      // TODO: This should be moved o prcessor
      if (!result.acquired && options.lockAcquisitionPolicy?.type !== 'skip') {
        throw new EmmettError(
          `Failed to acquire lock for processor '${options.processorId}'`,
        );
      }
      acquired = result.acquired;
      return acquired;
    },

    release: async (context: PostgreSQLProcessorLockContext): Promise<void> => {
      if (!acquired) return;

      const { projection, ...releaseOptions } = options;

      await releaseProcessorLock(context.execute, {
        ...releaseOptions,
        lockKey,
        projectionName: projection?.name,
      });

      acquired = false;
    },
  };
};

export const toProcessorLockKey = ({
  projection,
  processorId,
  partition,
  version,
}: Pick<
  TryAcquireProcessorLockOptions,
  'projection' | 'processorId' | 'version' | 'partition'
>): string =>
  projection
    ? toProjectionLockKey({
        projectionName: projection.name,
        partition: partition,
        version: projection.version,
      })
    : `${partition}:${processorId}:${version}`;
