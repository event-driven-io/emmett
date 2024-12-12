import { TaskProcessor } from '../../taskProcessing';

export type LockOptions = { lockId: number };

export type AcquireLockOptions = { lockId: string };
export type ReleaseLockOptions = { lockId: string };

export type Lock = {
  acquire(options: AcquireLockOptions): Promise<void>;
  tryAcquire(options: AcquireLockOptions): Promise<boolean>;
  release(options: ReleaseLockOptions): Promise<boolean>;
  withAcquire: <Result = unknown>(
    handle: () => Promise<Result>,
    options: AcquireLockOptions,
  ) => Promise<Result>;
};

export const InProcessLock = (): Lock => {
  const taskProcessor = new TaskProcessor({
    maxActiveTasks: Number.MAX_VALUE,
    maxQueueSize: Number.MAX_VALUE,
  });

  // Map to store ack functions of currently held locks: lockId -> ack()
  const locks = new Map<string, () => void>();

  return {
    async acquire({ lockId }: AcquireLockOptions): Promise<void> {
      // If the lock is already held, we just queue up another task in the same group.
      // TaskProcessor ensures tasks in the same group run one at a time.
      await new Promise<void>((resolve, reject) => {
        taskProcessor
          .enqueue(
            ({ ack }) => {
              // When this task starts, it means the previous lock (if any) was released
              // and now we have exclusive access.
              locks.set(lockId, ack);
              // We do NOT call ack() here. We hold onto the lock.
              resolve();
              return Promise.resolve();
            },
            { taskGroupId: lockId },
          )
          .catch(reject);
      });
    },

    async tryAcquire({ lockId }: AcquireLockOptions): Promise<boolean> {
      // If lock is already held, fail immediately
      if (locks.has(lockId)) {
        return false;
      }

      // TODO: Check pending queue
      await this.acquire({ lockId });

      return true;
    },

    release({ lockId }: ReleaseLockOptions): Promise<boolean> {
      const ack = locks.get(lockId);
      if (ack === undefined) {
        return Promise.resolve(true);
      }
      locks.delete(lockId);
      ack();
      return Promise.resolve(true);
    },

    async withAcquire<Result = unknown>(
      handle: () => Promise<Result>,
      { lockId }: AcquireLockOptions,
    ): Promise<Result> {
      return taskProcessor.enqueue(
        async ({ ack }) => {
          // When this task starts, it means the previous lock (if any) was released
          // and now we have exclusive access.
          locks.set(lockId, ack);

          // We do NOT call ack() here. We hold onto the lock.
          try {
            return await handle();
          } finally {
            locks.delete(lockId);
            ack();
          }
        },
        { taskGroupId: lockId },
      );
    },
  };
};
