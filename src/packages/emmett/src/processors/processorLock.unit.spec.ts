import { v7 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import { EmmettError } from '../errors';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertRejects,
  assertTrue,
} from '../testing';
import type { Event } from '../typing';
import type { Checkpointer } from './checkpoints';
import type { ProcessorLock } from './processorLock';
import { reactor } from './processors';

type TestEvent = Event<'test', { counter: number }>;

const inMemoryProcessorLock = (
  options: { acquiresAfterAttempts?: number; acquires?: boolean } = {},
): ProcessorLock & { attempts: number; isHeld: boolean } => {
  const { acquiresAfterAttempts = 0, acquires = true } = options;

  const lock = {
    attempts: 0,
    isHeld: false,
    tryAcquire: () => {
      lock.attempts++;
      lock.isHeld = acquires && lock.attempts > acquiresAfterAttempts;
      return Promise.resolve(lock.isHeld);
    },
    release: () => {
      lock.isHeld = false;
      return Promise.resolve();
    },
  };

  return lock;
};

const recordingCheckpointer = (order: string[]): Checkpointer<TestEvent> => ({
  read: () => {
    order.push('checkpoint');
    return Promise.resolve({ lastCheckpoint: null });
  },
  store: () => Promise.resolve({ success: false, reason: 'IGNORED' }),
});

void describe('Processor lock', () => {
  void it('starts without a lock when none is supplied', async () => {
    const processor = reactor<TestEvent>({
      processorId: uuid(),
      eachMessage: () => Promise.resolve(),
    });

    await processor.start();

    assertTrue(processor.isActive);
  });

  void describe('fail policy', () => {
    void it('throws when the lock is not acquired', async () => {
      const processorId = uuid();
      const lock = inMemoryProcessorLock({ acquires: false });

      const processor = reactor<TestEvent>({
        processorId,
        eachMessage: () => Promise.resolve(),
        lock: { lock, acquisitionPolicy: { type: 'fail' } },
      });

      await assertRejects(processor.start(), (error: EmmettError) =>
        error.message.includes(processorId),
      );
    });

    void it('is the default when a lock is supplied without a policy', async () => {
      const processorId = uuid();
      const lock = inMemoryProcessorLock({ acquires: false });

      const processor = reactor<TestEvent>({
        processorId,
        eachMessage: () => Promise.resolve(),
        lock: { lock },
      });

      await assertRejects(processor.start(), (error: EmmettError) =>
        error.message.includes(processorId),
      );
    });
  });

  void it('proceeds unlocked with the skip policy', async () => {
    const lock = inMemoryProcessorLock({ acquires: false });

    const processor = reactor<TestEvent>({
      processorId: uuid(),
      eachMessage: () => Promise.resolve(),
      lock: { lock, acquisitionPolicy: { type: 'skip' } },
    });

    await processor.start();

    assertTrue(processor.isActive);
    assertEqual(lock.attempts, 1);
  });

  void describe('retry policy', () => {
    void it('retries until acquired', async () => {
      const lock = inMemoryProcessorLock({ acquiresAfterAttempts: 2 });

      const processor = reactor<TestEvent>({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        lock: {
          lock,
          acquisitionPolicy: {
            type: 'retry',
            retries: 5,
            minTimeout: 1,
            maxTimeout: 5,
          },
        },
      });

      await processor.start();

      assertEqual(lock.attempts, 3);
      assertTrue(lock.isHeld);
    });

    void it('throws once the retries are exhausted', async () => {
      const lock = inMemoryProcessorLock({ acquires: false });

      const processor = reactor<TestEvent>({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        lock: {
          lock,
          acquisitionPolicy: {
            type: 'retry',
            retries: 3,
            minTimeout: 1,
            maxTimeout: 5,
          },
        },
      });

      // asyncRetry rejects from within the retry loop, so exhaustion surfaces
      // its own error rather than the tailored 'Failed to acquire lock' one
      await assertRejects(processor.start(), (error: EmmettError) =>
        error.message.includes('Retrying because of'),
      );

      assertEqual(lock.attempts, 3);
    });

    void it('falls back to failing when a single attempt is not acquired', async () => {
      const processorId = uuid();
      const lock = inMemoryProcessorLock({ acquires: false });

      const processor = reactor<TestEvent>({
        processorId,
        eachMessage: () => Promise.resolve(),
        lock: { lock, acquisitionPolicy: { type: 'retry', retries: 1 } },
      });

      await assertRejects(processor.start(), (error: EmmettError) =>
        error.message.includes(processorId),
      );

      assertEqual(lock.attempts, 1);
    });
  });

  void it('acquires the lock before the onStart hook and the checkpoint read', async () => {
    const order: string[] = [];
    const lock = inMemoryProcessorLock();

    const processor = reactor<TestEvent>({
      processorId: uuid(),
      eachMessage: () => Promise.resolve(),
      checkpoints: recordingCheckpointer(order),
      lock: {
        lock: {
          tryAcquire: (context) => {
            order.push('acquire');
            return lock.tryAcquire(context);
          },
          release: (context) => lock.release(context),
        },
      },
      hooks: {
        onStart: () => {
          order.push('onStart');
          return Promise.resolve();
        },
      },
    });

    await processor.start();

    assertDeepEqual(order, ['acquire', 'onStart', 'checkpoint']);
  });

  void it('does not read the checkpoint when acquisition fails', async () => {
    const processorId = uuid();
    const order: string[] = [];

    const processor = reactor<TestEvent>({
      processorId,
      eachMessage: () => Promise.resolve(),
      checkpoints: recordingCheckpointer(order),
      lock: { lock: inMemoryProcessorLock({ acquires: false }) },
    });

    await assertRejects(processor.start(), (error: EmmettError) =>
      error.message.includes(processorId),
    );

    assertDeepEqual(order, []);
  });

  void describe('release', () => {
    void it('releases the lock before the onClose hook runs', async () => {
      const order: string[] = [];
      const lock = inMemoryProcessorLock();

      const processor = reactor<TestEvent>({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        lock: {
          lock: {
            tryAcquire: (context) => lock.tryAcquire(context),
            release: (context) => {
              order.push('release');
              return lock.release(context);
            },
          },
        },
        hooks: {
          onClose: () => {
            // the PostgreSQL processor tears down its pool here, so the lock
            // has to be released first
            order.push('onClose');
            return Promise.resolve();
          },
        },
      });

      await processor.start();
      assertTrue(lock.isHeld);

      await processor.close();

      assertFalse(lock.isHeld);
      assertDeepEqual(order, ['release', 'onClose']);
    });

    void it('releases the lock even when the onClose hook throws', async () => {
      const lock = inMemoryProcessorLock();

      const processor = reactor<TestEvent>({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        lock: { lock },
        hooks: {
          onClose: () => Promise.reject(new EmmettError('onClose failed')),
        },
      });

      await processor.start();

      await assertRejects(processor.close(), (error: EmmettError) =>
        error.message.includes('onClose failed'),
      );

      assertFalse(lock.isHeld);
    });

    void it('does not release a lock it never acquired', async () => {
      let released = false;
      const lock: ProcessorLock = {
        tryAcquire: () => Promise.resolve(false),
        release: () => {
          released = true;
          return Promise.resolve();
        },
      };

      const processor = reactor<TestEvent>({
        processorId: uuid(),
        eachMessage: () => Promise.resolve(),
        lock: { lock, acquisitionPolicy: { type: 'skip' } },
      });

      await processor.start();
      await processor.close();

      assertFalse(released);
    });
  });
});
