import type { SQLExecutor } from '@event-driven-io/dumbo';
import { EmmettError } from '@event-driven-io/emmett';
import {
  releaseProcessorLock,
  toProcessorLockKey,
  tryAcquireProcessorLockWithRetry,
  type LockAcquisitionPolicy,
  type TryAcquireProcessorLockOptions,
} from './tryAcquireProcessorLock';

export class ProcessorLock {
  private acquired = false;
  private readonly lockKey: string;
  private readonly options: TryAcquireProcessorLockOptions & {
    lockPolicy?: LockAcquisitionPolicy;
  };

  constructor(
    options: TryAcquireProcessorLockOptions & {
      lockPolicy?: LockAcquisitionPolicy;
    },
  ) {
    this.options = options;
    this.lockKey = toProcessorLockKey(options);
  }

  async tryAcquire(options: { execute: SQLExecutor }): Promise<void> {
    if (this.acquired) {
      return;
    }

    const result = await tryAcquireProcessorLockWithRetry(options.execute, {
      ...this.options,
      lockKey: this.lockKey,
    });

    if (result.acquired) {
      this.acquired = true;
    } else if (this.options.lockPolicy?.type === 'fail') {
      throw new EmmettError(
        `Failed to acquire lock for processor '${this.options.processorId}'`,
      );
    }
  }

  async release(options: { execute: SQLExecutor }): Promise<void> {
    if (!this.acquired) {
      return;
    }

    const {
      lockPolicy: _lockPolicy,
      projection,
      ...releaseOptions
    } = this.options;

    await releaseProcessorLock(options.execute, {
      ...releaseOptions,
      lockKey: this.lockKey,
      projectionName: projection?.name,
    });

    this.acquired = false;
  }
}
