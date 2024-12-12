import { beforeEach, describe, it } from 'node:test';
import { InProcessLock, type Lock } from '.';
import { assertDeepEqual, assertEqual } from '../../testing';

void describe('InProcessLock', () => {
  let lock: Lock;

  beforeEach(() => {
    lock = InProcessLock();
  });

  void it('should acquire and release a lock', async () => {
    let locked = false;

    await lock.acquire({ lockId: '1' });
    try {
      locked = true; // Lock acquired
    } finally {
      await lock.release({ lockId: '1' });
    }

    assertEqual(locked, true, 'Lock was not acquired correctly');
  });

  void it('should prevent concurrent access to the same lock', async () => {
    let activeCount = 0;

    const task1 = async () => {
      await lock.acquire({ lockId: '1' });
      try {
        activeCount++;
        await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate work
        assertEqual(
          activeCount,
          1,
          'Another task acquired the lock concurrently',
        );
      } finally {
        activeCount--;
        await lock.release({ lockId: '1' });
      }
    };

    const task2 = task1; // Both tasks try to acquire the same lock

    await Promise.all([task1(), task2()]);
  });

  void it('should allow sequential access to the same lock', async () => {
    const executionOrder: string[] = [];

    const task1 = async () => {
      await lock.acquire({ lockId: '1' });
      try {
        executionOrder.push('Task 1');
      } finally {
        await lock.release({ lockId: '1' });
      }
    };

    const task2 = async () => {
      await lock.acquire({ lockId: '1' });
      try {
        executionOrder.push('Task 2');
      } finally {
        await lock.release({ lockId: '1' });
      }
    };

    await Promise.all([task1(), task2()]);

    assertDeepEqual(
      executionOrder,
      ['Task 1', 'Task 2'],
      'Tasks did not execute sequentially',
    );
  });

  void it('should allow tryAcquire to acquire an available lock', async () => {
    const acquired = await lock.tryAcquire({ lockId: '1' });
    assertEqual(acquired, true, 'Failed to acquire an available lock');

    await lock.release({ lockId: '1' });
  });

  void it('should fail tryAcquire when the lock is already held', async () => {
    await lock.acquire({ lockId: '1' });

    const acquired = await lock.tryAcquire({ lockId: '1' });
    assertEqual(acquired, false, 'tryAcquire acquired a held lock');

    await lock.release({ lockId: '1' });
  });

  void it('should release the lock even if an exception is thrown', async () => {
    let exceptionThrown = false;
    let lockReleased = false;

    try {
      await lock.acquire({ lockId: '1' });
      throw new Error('Simulated error');
    } catch {
      exceptionThrown = true;
    } finally {
      await lock.release({ lockId: '1' });
      lockReleased = true;
    }

    assertEqual(exceptionThrown, true, 'Exception was not thrown');
    assertEqual(lockReleased, true, 'Lock was not released after exception');
  });

  void it('should support withAcquire to acquire and release a lock automatically', async () => {
    let value = 0;

    await lock.withAcquire(
      async () => {
        value = 42;
        return Promise.resolve();
      },
      { lockId: '1' },
    );

    assertEqual(value, 42, 'withAcquire did not execute the provided function');
  });

  void it('should not allow concurrent access to withAcquire using the same lockId', async () => {
    let activeCount = 0;

    const task = async () => {
      await lock.withAcquire(
        async () => {
          activeCount++;
          await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate work
          assertEqual(
            activeCount,
            1,
            'Another task accessed the lock concurrently',
          );
          activeCount--;
        },
        { lockId: '1' },
      );
    };

    await Promise.all([task(), task()]);
  });
});
