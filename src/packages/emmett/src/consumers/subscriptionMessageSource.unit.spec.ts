import { describe, it } from 'vitest';
import { ProcessorCheckpoint } from '../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertRejects,
  assertTrue,
} from '../testing';
import type { AnyMessage, RecordedMessage } from '../typing';
import type { MessageSourceBatch } from './messageSource';
import {
  boundedMessageQueue,
  subscriptionMessageSource,
  type SubscribeOptions,
} from './subscriptionMessageSource';

const batchAt = (
  checkpoint: string,
): MessageSourceBatch<AnyMessage, never> => ({
  messages: [
    {
      type: 'Tested',
      data: {},
      metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
    } as unknown as RecordedMessage<AnyMessage, never>,
  ],
  lastCheckpoint: ProcessorCheckpoint(checkpoint),
});

const drain = async (
  iterable: AsyncIterable<MessageSourceBatch<AnyMessage, never>>,
  take: number,
  controller: AbortController,
) => {
  const batches = [];
  for await (const batch of iterable) {
    batches.push(batch);
    if (batches.length >= take) {
      controller.abort();
      break;
    }
  }
  return batches;
};

void describe('boundedMessageQueue', () => {
  void it('delivers pushed items in order', async () => {
    const queue = boundedMessageQueue<number>({ capacity: 4 });
    const controller = new AbortController();

    void queue.push(1);
    void queue.push(2);
    queue.complete();

    const received = [];
    for await (const item of queue.iterate(controller.signal))
      received.push(item);

    assertDeepEqual(received, [1, 2]);
  });

  void it('applies backpressure once the capacity is reached', async () => {
    const queue = boundedMessageQueue<number>({ capacity: 1 });
    const controller = new AbortController();

    let secondPushResolved = false;

    void queue.push(1);
    void queue.push(2).then(() => {
      secondPushResolved = true;
    });

    assertEqual(secondPushResolved, false);

    const iterator = queue.iterate(controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    await Promise.resolve();
    await Promise.resolve();

    assertTrue(secondPushResolved);

    controller.abort();
  });

  void it('surfaces a failure to the iterating side', async () => {
    const queue = boundedMessageQueue<number>({ capacity: 4 });
    const controller = new AbortController();

    queue.fail(new Error('subscription died'));

    await assertRejects(
      (async () => {
        for await (const _ of queue.iterate(controller.signal));
      })(),
    );
  });
});

void describe('subscriptionMessageSource', () => {
  void it('resubscribes from the last delivered checkpoint after a retryable error', async () => {
    const attempts: SubscribeOptions[] = [];

    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: (options) => {
        attempts.push(options);
        const attempt = attempts.length;

        return (async function* () {
          if (attempt === 1) {
            yield batchAt('1');
            await Promise.resolve();
            throw new Error('connection reset');
          }
          yield batchAt('2');
        })();
      },
      readLastCheckpoint: () => Promise.resolve(null),
      resilience: { resubscribeDelayInMs: 0 },
    });

    const controller = new AbortController();
    const batches = await drain(
      source.read({ from: 'BEGINNING', signal: controller.signal }),
      2,
      controller,
    );

    assertEqual(attempts.length, 2);
    assertDeepEqual(attempts[0]!.from, 'BEGINNING');
    assertDeepEqual(attempts[1]!.from, {
      lastCheckpoint: ProcessorCheckpoint('1'),
    });
    assertDeepEqual(
      batches.map((b) => b.lastCheckpoint),
      [ProcessorCheckpoint('1'), ProcessorCheckpoint('2')],
    );
  });

  void it('gives up when the error is not retryable', async () => {
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () =>
        (async function* () {
          yield batchAt('1');
          await Promise.resolve();
          throw new Error('server unavailable');
        })(),
      readLastCheckpoint: () => Promise.resolve(null),
      resilience: {
        resubscribeDelayInMs: 0,
        shouldRetryError: (error) =>
          (error as Error).message !== 'server unavailable',
      },
    });

    const controller = new AbortController();

    await assertRejects(
      (async () => {
        for await (const _ of source.read({
          from: 'BEGINNING',
          signal: controller.signal,
        }));
      })(),
    );
  });

  void it('stops resubscribing once the signal is aborted', async () => {
    let attempts = 0;

    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () => {
        attempts++;
        return (async function* () {
          yield batchAt('1');
          await Promise.resolve();
          throw new Error('connection reset');
        })();
      },
      readLastCheckpoint: () => Promise.resolve(null),
      resilience: { resubscribeDelayInMs: 0 },
    });

    const controller = new AbortController();

    await drain(
      source.read({ from: 'BEGINNING', signal: controller.signal }),
      1,
      controller,
    );

    assertEqual(attempts, 1);
  });

  void it('ends when the subscription completes on its own', async () => {
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () =>
        (async function* () {
          await Promise.resolve();
          yield batchAt('1');
        })(),
      readLastCheckpoint: () => Promise.resolve(null),
      resilience: { resubscribeDelayInMs: 0 },
    });

    const controller = new AbortController();
    const batches = [];

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    }))
      batches.push(batch);

    assertEqual(batches.length, 1);
  });
});
