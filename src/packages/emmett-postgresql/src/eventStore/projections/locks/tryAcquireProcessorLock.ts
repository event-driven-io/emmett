import { single, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  asyncRetry,
  hashText,
  isBigint,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import {
  callReleaseProcessorLock,
  callTryAcquireProcessorLock,
} from '../../schema/processors/processorsLocks';
import { DefaultPostgreSQLProcessorLockPolicy } from './postgreSQLProcessorLock';

export type TryAcquireProcessorLockOptions = {
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
  lockKey: string | bigint;
  lockTimeoutSeconds?: number;
};

export type TryAcquireProcessorLockResult =
  | {
      acquired: true;
      checkpoint: string;
    }
  | { acquired: false };

export type LockAcquisitionPolicy =
  | { type: 'fail' }
  | { type: 'skip' }
  | {
      type: 'retry';
      retries: number;
      minTimeout?: number;
      maxTimeout?: number;
    };

export const PROCESSOR_LOCK_DEFAULT_TIMEOUT_SECONDS = 300;

export const tryAcquireProcessorLock = async (
  execute: SQLExecutor,
  options: TryAcquireProcessorLockOptions,
): Promise<TryAcquireProcessorLockResult> => {
  const lockKeyBigInt = isBigint(options.lockKey)
    ? options.lockKey
    : await hashText(options.lockKey);

  const { acquired, checkpoint } = await single(
    execute.command<{ acquired: boolean; checkpoint: string | null }>(
      callTryAcquireProcessorLock({
        lockKey: lockKeyBigInt.toString(),
        processorId: options.processorId,
        version: options.version,
        partition: options.partition,
        processorInstanceId: options.processorInstanceId,
        projectionName: options.projection?.name ?? null,
        projectionType: options.projection?.handlingType
          ? options.projection.handlingType === 'inline'
            ? 'i'
            : 'a'
          : null,
        projectionKind: options.projection?.kind ?? null,
        lockTimeoutSeconds:
          options.lockTimeoutSeconds ?? PROCESSOR_LOCK_DEFAULT_TIMEOUT_SECONDS,
      }),
    ),
  );

  return acquired
    ? { acquired: true, checkpoint: checkpoint! }
    : { acquired: false };
};

export const tryAcquireProcessorLockWithRetry = async (
  execute: SQLExecutor,
  options: TryAcquireProcessorLockOptions & {
    lockAcquisitionPolicy?: LockAcquisitionPolicy;
  },
): Promise<TryAcquireProcessorLockResult> => {
  const policy =
    options.lockAcquisitionPolicy ?? DefaultPostgreSQLProcessorLockPolicy;

  if (policy.type === 'retry') {
    return asyncRetry(() => tryAcquireProcessorLock(execute, options), {
      retries: policy.retries - 1,
      minTimeout: policy.minTimeout,
      maxTimeout: policy.maxTimeout,
      shouldRetryResult: (r) => !r.acquired,
    });
  }

  return tryAcquireProcessorLock(execute, options);
};

export type ReleaseProcessorLockOptions = {
  processorId: string;
  version: number;
  partition: string;
  processorInstanceId: string;
  projectionName?: string;
  lockKey: string | bigint;
};

export const releaseProcessorLock = async (
  execute: SQLExecutor,
  options: ReleaseProcessorLockOptions,
): Promise<boolean> => {
  const lockKeyBigInt = isBigint(options.lockKey)
    ? options.lockKey
    : await hashText(options.lockKey);

  const { result } = await single(
    execute.command<{ result: boolean }>(
      callReleaseProcessorLock({
        lockKey: lockKeyBigInt.toString(),
        processorId: options.processorId,
        partition: options.partition,
        version: options.version,
        processorInstanceId: options.processorInstanceId,
        projectionName: options.projectionName ?? null,
      }),
    ),
  );

  return result;
};
