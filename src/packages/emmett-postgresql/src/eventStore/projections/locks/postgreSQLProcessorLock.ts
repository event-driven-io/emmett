import { LogEvent, type ObservabilityScope } from '@event-driven-io/almanac';
import type { SQLExecutor } from '@event-driven-io/dumbo';
import {
  DefaultProcessorLockPolicy,
  EmmettAttributes,
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
  observabilityScope?: ObservabilityScope;
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
  const lockAttributes = {
    [EmmettAttributes.processor.id]: options.processorId,
    [EmmettAttributes.processor.instanceId]: options.processorInstanceId,
    [EmmettAttributes.processor.lock.key]: String(lockKey),
  };
  const logDebug = (context: PostgreSQLProcessorLockContext, message: string) =>
    context.observabilityScope?.log(LogEvent.debug(lockAttributes, message));

  return {
    tryAcquire: async (
      context: PostgreSQLProcessorLockContext,
    ): Promise<boolean> => {
      if (acquired) {
        logDebug(context, 'Processor lock already held, reusing it');
        return true;
      }

      const result = await tryAcquireProcessorLock(context.execute, {
        ...options,
        lockKey,
      });

      acquired = result.acquired;
      logDebug(
        context,
        acquired ? 'Processor lock acquired' : 'Processor lock not acquired',
      );
      return acquired;
    },

    release: async (context: PostgreSQLProcessorLockContext): Promise<void> => {
      if (!acquired) {
        logDebug(context, 'Processor lock not held, skipping release');
        return;
      }

      const { projection, ...releaseOptions } = options;

      const ownedByThisInstance = await releaseProcessorLock(context.execute, {
        ...releaseOptions,
        lockKey,
        projectionName: projection?.name,
      });

      acquired = false;
      logDebug(
        context,
        ownedByThisInstance
          ? 'Processor lock released'
          : 'Processor lock release skipped: another instance owns the processor',
      );
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
