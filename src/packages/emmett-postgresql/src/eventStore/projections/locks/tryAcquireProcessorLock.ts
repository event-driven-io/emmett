import { single, sql, type SQLExecutor } from '@event-driven-io/dumbo';
import { hashText, isBigint } from '@event-driven-io/emmett';
import { defaultTag, unknownTag } from '../../schema';
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
};

export type TryAcquireProcessorLockResult =
  | {
      acquired: true;
      checkpoint: string;
    }
  | { acquired: false };

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
        `SELECT * FROM emt_try_acquire_processor_lock(%s::BIGINT, %L, %s, %L, %L, %L, %L, %L);`,
        lockKeyBigInt.toString(),
        options.processorId,
        options.version,
        options.partition ?? defaultTag,
        options.processorInstanceId ?? unknownTag,
        options.projection?.name ?? null,
        options.projection?.type ?? null,
        options.projection?.kind ?? null,
      ),
    ),
  );

  return acquired
    ? { acquired: true, checkpoint: checkpoint! }
    : { acquired: false };
};

export const releaseProcessorLock = async (
  execute: SQLExecutor,
  options: {
    lockKey: string | bigint;
    processorId: string;
    partition: string;
    version: number;
    projectionName?: string;
    processorInstanceId?: string;
  },
): Promise<boolean> => {
  const lockKeyBigInt = isBigint(options.lockKey)
    ? options.lockKey
    : await hashText(options.lockKey);

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
