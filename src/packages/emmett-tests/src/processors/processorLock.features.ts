import {
  assertFalse,
  assertTrue,
  type DefaultRecord,
  type ProcessorLock,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { beforeEach, describe, it } from 'vitest';

export type ProcessorLockTestContext<HandlerContext extends DefaultRecord> = {
  createLock: (options: {
    processorId: string;
    processorInstanceId: string;
  }) => ProcessorLock<HandlerContext>;
  /**
   * Runs the handler with a fresh context, mirroring what the processor's
   * processing scope does for a single lock operation.
   */
  withContext: <T>(
    handler: (context: HandlerContext) => Promise<T>,
  ) => Promise<T>;
};

export type ProcessorLockFactory<HandlerContext extends DefaultRecord> =
  () => Promise<ProcessorLockTestContext<HandlerContext>>;

export function testProcessorLock<HandlerContext extends DefaultRecord>(
  factory: ProcessorLockFactory<HandlerContext>,
) {
  describe('ProcessorLock', () => {
    let context: ProcessorLockTestContext<HandlerContext>;

    beforeEach(async () => {
      context = await factory();
    });

    const lockFor = (processorId: string, processorInstanceId: string) =>
      context.createLock({ processorId, processorInstanceId });

    it('grants the lock to the first instance', async () => {
      const lock = lockFor(uuid(), 'first');

      assertTrue(await context.withContext((c) => lock.tryAcquire(c)));
    });

    it('refuses the lock while another instance holds it', async () => {
      const processorId = uuid();
      const first = lockFor(processorId, 'first');
      const second = lockFor(processorId, 'second');

      assertTrue(await context.withContext((c) => first.tryAcquire(c)));

      assertFalse(await context.withContext((c) => second.tryAcquire(c)));
    });

    it('grants the lock to another instance after release', async () => {
      const processorId = uuid();
      const first = lockFor(processorId, 'first');
      const second = lockFor(processorId, 'second');

      await context.withContext((c) => first.tryAcquire(c));
      await context.withContext((c) => first.release(c));

      assertTrue(await context.withContext((c) => second.tryAcquire(c)));
    });

    // the processor calls tryAcquire again on restart, and release on close
    // regardless of how start went, so both have to be idempotent
    it('grants the lock again to the instance already holding it', async () => {
      const lock = lockFor(uuid(), 'first');

      await context.withContext((c) => lock.tryAcquire(c));

      assertTrue(await context.withContext((c) => lock.tryAcquire(c)));
    });

    it('releases a lock that was never acquired without throwing', async () => {
      const lock = lockFor(uuid(), 'first');

      await context.withContext((c) => lock.release(c));
    });
  });
}
