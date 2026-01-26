import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { asyncRetry, hashText, isBigint } from '@event-driven-io/emmett';
import { defaultTag, unknownTag } from '../../schema/typing';
import { DefaultPostgreSQLProcessorLockPolicy } from './postgreSQLProcessorLock';
import { toProjectionLockKey } from './tryAcquireProjectionLock';

export type TryAcquireProcessorLockOptions = {
  processorId: string;
  version: number;
  partition?: string;
  processorInstanceId?: string;
  projection?: {
    name: string;
    type: 'i' | 'a';
    kind: string;
    version?: number;
  };
  lockKey?: string | bigint;
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
        partition: partition ?? defaultTag,
        version: projection.version ?? version,
      })
    : `${partition ?? defaultTag}:${processorId}:${version}`;

export const PROCESSOR_LOCK_DEFAULT_TIMEOUT_SECONDS = 300;

export const tryAcquireProcessorLock = async (
  execute: SQLExecutor,
  options: TryAcquireProcessorLockOptions,
): Promise<TryAcquireProcessorLockResult> => {
  const lockKeyBigInt = isBigint(options.lockKey)
    ? options.lockKey
    : await hashText(options.lockKey ?? toProcessorLockKey(options));

  const { acquired, checkpoint } = await single(
    execute.command<{ acquired: boolean; checkpoint: string | null }>(
      sql(
        `SELECT * FROM emt_try_acquire_processor_lock(%s::BIGINT, %L, %s, %L, %L, %L, %L, %L, %s);`,
        lockKeyBigInt.toString(),
        options.processorId,
        options.version,
        options.partition ?? defaultTag,
        options.processorInstanceId ?? unknownTag,
        options.projection?.name ?? null,
        options.projection?.type ?? null,
        options.projection?.kind ?? null,
        options.lockTimeoutSeconds ?? PROCESSOR_LOCK_DEFAULT_TIMEOUT_SECONDS,
      ),
    ),
  );

  return acquired
    ? { acquired: true, checkpoint: checkpoint! }
    : { acquired: false };
};

export const tryAcquireProcessorLockWithRetry = async (
  execute: SQLExecutor,
  options: TryAcquireProcessorLockOptions & {
    lockPolicy?: LockAcquisitionPolicy;
  },
): Promise<TryAcquireProcessorLockResult> => {
  const policy = options.lockPolicy ?? DefaultPostgreSQLProcessorLockPolicy;

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
  partition?: string;
  processorInstanceId?: string;
  projectionName?: string;
  lockKey?: string | bigint;
};

export const releaseProcessorLock = async (
  execute: SQLExecutor,
  options: ReleaseProcessorLockOptions,
): Promise<boolean> => {
  const lockKeyBigInt = isBigint(options.lockKey)
    ? options.lockKey
    : await hashText(options.lockKey ?? toProcessorLockKey(options));

  const { result } = await single(
    execute.command<{ result: boolean }>(
      sql(
        `SELECT emt_release_processor_lock(%s::BIGINT, %L, %L, %s, %L, %L) as result;`,
        lockKeyBigInt.toString(),
        options.processorId,
        options.partition,
        options.version,
        options.processorInstanceId ?? unknownTag,
        options.projectionName ?? null,
      ),
    ),
  );

  return result;
};
