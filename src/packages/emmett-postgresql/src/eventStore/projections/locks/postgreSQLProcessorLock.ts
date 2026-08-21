import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  DefaultProcessorLockPolicy,
  type LockAcquisitionPolicy,
  type ProcessorLock,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import { toProjectionLockKey } from './postgreSQLProjectionLock';
import {
  releaseProcessorLock,
  tryAcquireProcessorLock,
  type TryAcquireProcessorLockOptions,
} from './tryAcquireProcessorLock';

export type PostgreSQLProcessorLockOptions = {
  databaseSchemaName?: string;
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
  /** @deprecated Pass `lock.acquisitionPolicy` to the processor options instead */
  lockAcquisitionPolicy?: LockAcquisitionPolicy;
};

export type PostgreSQLProcessorLockContext = {
  execute: SQLExecutor;
};

export type PostgreSQLProcessorLock =
  ProcessorLock<PostgreSQLProcessorLockContext>;

export const DefaultPostgreSQLProcessorLockPolicy: LockAcquisitionPolicy =
  DefaultProcessorLockPolicy;

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
        console.log(
          `Lock for processor '${options.processorId}' is already acquired by this instance. Reusing the lock.`,
        );
        return true;
      }

      const result = await tryAcquireProcessorLock(context.execute, {
        ...options,
        lockKey,
      });

      acquired = result.acquired;
      return acquired;
    },

    release: async (context: PostgreSQLProcessorLockContext): Promise<void> => {
      if (!acquired) {
        console.log(
          `Lock for processor '${options.processorId}' is not acquired by this instance. Skipping release.`,
        );
        return;
      }

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
