import { describe, it } from 'vitest';
import {
  assertDeepEqual,
  assertEqual,
  assertThrowsAsync,
} from '../testing/assertions';
import {
  guardBoundedAccess,
  guardExclusiveAccess,
  guardInitializedOnce,
} from './executionGuards';

void describe('Task Processing Guards', () => {
  void describe('guardExclusiveAccess', () => {
    void it('ensures operations run one at a time', async () => {
      const guard = guardExclusiveAccess();
      const executionOrder: number[] = [];
      let activeOperations = 0;

      const operation = async (id: number) => {
        activeOperations++;
        assertEqual(activeOperations, 1, 'Only one operation should be active');
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeOperations--;
      };

      await Promise.all([
        guard.execute(() => operation(1)),
        guard.execute(() => operation(2)),
        guard.execute(() => operation(3)),
      ]);

      assertEqual(executionOrder.length, 3);
      assertEqual(activeOperations, 0);
    });

    void it('propagates errors correctly', async () => {
      const guard = guardExclusiveAccess();

      await assertThrowsAsync(
        () => guard.execute(() => Promise.reject(new Error('test error'))),
        (e) => /test error/.test(e.message),
      );
    });

    void it('stops and rejects new operations after stop with force', async () => {
      const guard = guardExclusiveAccess();

      await guard.stop({ force: true });

      await assertThrowsAsync(
        () => guard.execute(() => Promise.resolve(42)),
        (e) => /TaskProcessor has been stopped/.test(e.message),
      );
    });

    void it('waits for active operations when stopping without force', async () => {
      const guard = guardExclusiveAccess();
      let operationCompleted = false;

      const operationPromise = guard.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        operationCompleted = true;
        return 42;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await guard.stop();

      assertEqual(
        operationCompleted,
        true,
        'Should wait for operation to complete',
      );
      const result = await operationPromise;
      assertEqual(result, 42);
    });
  });

  void describe('guardBoundedAccess', () => {
    void it('limits concurrent access to resources', async () => {
      let resourceId = 0;
      const guard = guardBoundedAccess(() => ({ id: ++resourceId }), {
        maxResources: 2,
        reuseResources: true,
      });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const operation = async (resource: { id: number }) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return resource.id;
      };

      const results = await Promise.all([
        guard.execute(operation),
        guard.execute(operation),
        guard.execute(operation),
        guard.execute(operation),
      ]);

      assertEqual(maxConcurrent, 2, 'Should not exceed max resources');
      assertEqual(results.length, 4);
    });

    void it('reuses resources when enabled', async () => {
      const createdResources: number[] = [];
      const guard = guardBoundedAccess(
        () => {
          const id = createdResources.length + 1;
          createdResources.push(id);
          return { id };
        },
        {
          maxResources: 2,
          reuseResources: true,
        },
      );

      await Promise.all([
        guard.execute((r) => Promise.resolve(r.id)),
        guard.execute((r) => Promise.resolve(r.id)),
        guard.execute((r) => Promise.resolve(r.id)),
        guard.execute((r) => Promise.resolve(r.id)),
      ]);

      assertEqual(
        createdResources.length,
        2,
        'Should only create maxResources when reusing',
      );
    });

    void it('releases resources on error', async () => {
      const guard = guardBoundedAccess(() => ({ id: 1 }), {
        maxResources: 1,
        reuseResources: true,
      });

      await assertThrowsAsync(
        () => guard.execute(() => Promise.reject(new Error('test error'))),
        (e) => /test error/.test(e.message),
      );

      const result = await guard.execute((r) => Promise.resolve(r.id));
      assertEqual(result, 1, 'Should be able to use resource after error');
    });

    void it('stops and clears queue on stop with force', async () => {
      const guard = guardBoundedAccess(() => ({ id: 1 }), {
        maxResources: 1,
        reuseResources: false,
      });

      await guard.stop({ force: true });

      await assertThrowsAsync(
        () => guard.execute(() => Promise.resolve(1)),
        (e) => /TaskProcessor has been stopped/.test(e.message),
      );
    });

    void it('waits for active operations when stopping without force', async () => {
      const guard = guardBoundedAccess(() => ({ id: 1 }), {
        maxResources: 1,
        reuseResources: true,
      });

      let operationCompleted = false;

      const operationPromise = guard.execute(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        operationCompleted = true;
        return 1;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await guard.stop();

      assertEqual(
        operationCompleted,
        true,
        'Should wait for operation to complete',
      );
      const result = await operationPromise;
      assertEqual(result, 1);
    });
  });

  void describe('guardInitializedOnce', () => {
    void it('ensures initialization happens only once', async () => {
      let initCount = 0;
      const guard = guardInitializedOnce(async () => {
        initCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `init-${initCount}`;
      });

      const results = await Promise.all([
        guard.ensureInitialized(),
        guard.ensureInitialized(),
        guard.ensureInitialized(),
      ]);

      assertEqual(initCount, 1, 'Should initialize only once');
      assertDeepEqual(
        results,
        ['init-1', 'init-1', 'init-1'],
        'All calls should return the same result',
      );
    });

    void it('retries on failure', async () => {
      let attempts = 0;
      const guard = guardInitializedOnce(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Not ready yet');
          }
          return Promise.resolve(`success-${attempts}`);
        },
        { maxRetries: 5 },
      );

      const result = await guard.ensureInitialized();
      assertEqual(attempts, 3, 'Should retry until success');
      assertEqual(
        result,
        'success-3',
        'Should return result from successful attempt',
      );
    });

    void it('throws after max retries exceeded', async () => {
      let attempts = 0;
      const guard = guardInitializedOnce(
        async () => {
          attempts++;
          return Promise.reject(new Error('Always fails'));
        },
        { maxRetries: 2 },
      );

      await assertThrowsAsync(
        () => guard.ensureInitialized(),
        (e) => /Always fails/.test(e.message),
      );
      assertEqual(attempts, 3, 'Should attempt maxRetries + 1 times');
    });

    void it('allows reset to reinitialize', async () => {
      let initCount = 0;
      const guard = guardInitializedOnce(() => {
        initCount++;
        return Promise.resolve(`value-${initCount}`);
      });

      const first = await guard.ensureInitialized();
      assertEqual(initCount, 1);
      assertEqual(first, 'value-1');

      guard.reset();
      const second = await guard.ensureInitialized();
      assertEqual(initCount, 2, 'Should reinitialize after reset');
      assertEqual(second, 'value-2', 'Should return new value after reset');
    });

    void it('stops and prevents new initialization after stop', async () => {
      const guard = guardInitializedOnce(() => {
        return Promise.resolve('initialized');
      });

      await guard.stop({ force: true });

      await assertThrowsAsync(
        () => guard.ensureInitialized(),
        (e) => /TaskProcessor has been stopped/.test(e.message),
      );
    });
  });
});
