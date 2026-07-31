import { describe, it, vi } from 'vitest';
import { ProcessorCheckpoint } from '../../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertRejects,
  assertTrue,
} from '../../testing';
import type { AnyMessage, RecordedMessage } from '../../typing';
import type { MessageSourceMessage } from './messageSource';
import {
  boundedMessageQueue,
  subscriptionMessageSource,
  type SubscribeOptions,
} from './subscriptionMessageSource';

const messageAt = (checkpoint: string): RecordedMessage<AnyMessage, never> =>
  ({
    type: 'Tested',
    data: {},
    metadata: { checkpoint: ProcessorCheckpoint(checkpoint) },
  }) as unknown as RecordedMessage<AnyMessage, never>;

const drain = async (
  iterable: AsyncIterable<MessageSourceMessage<AnyMessage, never>>,
  take: number,
  controller: AbortController,
) => {
  const received = [];
  for await (const message of iterable) {
    received.push(message);
    if (received.length >= take) {
      controller.abort();
      break;
    }
  }
  return received;
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
            yield messageAt('1');
            await Promise.resolve();
            throw new Error('connection reset');
          }
          yield messageAt('2');
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: { minTimeout: 0, randomize: false },
    });

    const controller = new AbortController();
    const received = await drain(
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
      received.map((m) => m.metadata.checkpoint),
      [ProcessorCheckpoint('1'), ProcessorCheckpoint('2')],
    );
  });

  void it('gives up when the error is not retryable', async () => {
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () =>
        (async function* () {
          yield messageAt('1');
          await Promise.resolve();
          throw new Error('server unavailable');
        })(),
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: {
        minTimeout: 0,
        randomize: false,
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
          yield messageAt('1');
          await Promise.resolve();
          throw new Error('connection reset');
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: { minTimeout: 0, randomize: false },
    });

    const controller = new AbortController();

    await drain(
      source.read({ from: 'BEGINNING', signal: controller.signal }),
      1,
      controller,
    );

    assertEqual(attempts, 1);
  });

  void it('surfaces repeated failures after the configured retry limit', async () => {
    let attempts = 0;
    const failure = new Error('connection reset');
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () => {
        attempts++;
        return (async function* () {
          await Promise.resolve();
          yield* [] as MessageSourceMessage<AnyMessage, never>[];
          throw failure;
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: {
        retries: 2,
        minTimeout: 0,
        randomize: false,
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
      failure,
    );

    assertEqual(3, attempts);
  });

  void it('restores the reconnect allowance after receiving messages', async () => {
    let attempts = 0;
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () => {
        attempts++;
        return (async function* () {
          await Promise.resolve();
          yield messageAt(`${attempts}`);
          throw new Error('connection reset');
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: {
        retries: 1,
        minTimeout: 0,
        randomize: false,
      },
    });
    const controller = new AbortController();

    const received = await drain(
      source.read({ from: 'BEGINNING', signal: controller.signal }),
      3,
      controller,
    );

    assertEqual(3, attempts);
    assertEqual(3, received.length);
  });

  void it('waits according to the configured reconnect schedule', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const failure = new Error('connection reset');
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () => {
        attempts++;
        return (async function* () {
          await Promise.resolve();
          yield* [] as MessageSourceMessage<AnyMessage, never>[];
          throw failure;
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: {
        retries: 2,
        minTimeout: 10,
        factor: 2,
        randomize: false,
      },
    });
    const controller = new AbortController();

    try {
      const reading = assertRejects(
        (async () => {
          for await (const _ of source.read({
            from: 'BEGINNING',
            signal: controller.signal,
          }));
        })(),
        failure,
      );

      await vi.advanceTimersByTimeAsync(9);
      assertEqual(1, attempts);

      await vi.advanceTimersByTimeAsync(1);
      assertEqual(2, attempts);

      await vi.advanceTimersByTimeAsync(19);
      assertEqual(2, attempts);

      await vi.advanceTimersByTimeAsync(1);
      await reading;

      assertEqual(3, attempts);
    } finally {
      vi.useRealTimers();
    }
  });

  void it('keeps receiving after a live subscription closes', async () => {
    let attempts = 0;
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () => {
        attempts++;
        return (async function* () {
          await Promise.resolve();
          yield messageAt(`${attempts}`);
        })();
      },
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: {
        forever: true,
        minTimeout: 0,
        randomize: false,
        shouldRetryResult: () => true,
      },
    });
    const controller = new AbortController();

    const received = await drain(
      source.read({ from: 'BEGINNING', signal: controller.signal }),
      2,
      controller,
    );

    assertEqual(2, attempts);
    assertEqual(2, received.length);
  });

  void it('ends when the subscription completes on its own', async () => {
    const source = subscriptionMessageSource<AnyMessage, never>({
      subscribe: () =>
        (async function* () {
          await Promise.resolve();
          yield messageAt('1');
        })(),
      readLastMessageCheckpoint: () => Promise.resolve(null),
      resilience: { minTimeout: 0, randomize: false },
    });

    const controller = new AbortController();
    const received = [];

    for await (const message of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    }))
      received.push(message);

    assertEqual(received.length, 1);
  });
});
