import {
  assertEqual,
  assertFalse,
  assertRejects,
  assertTrue,
  isGlobalStreamCaughtUp,
  NoRetries,
  ProcessorCheckpoint,
  type Event,
  type MessageSourceBatch,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import { Readable } from 'stream';
import { describe, it } from 'vitest';
import type { EventStoreDBReadEventMetadata } from '../eventstoreDBEventStore';
import { eventStoreDBMessageSource } from './eventStoreDBMessageSource';

type Tested = Event<'Tested', { index: number }>;

const resolvedEvent = (index: number) => ({
  event: {
    id: `${index}`,
    type: 'Tested',
    data: { index },
    metadata: {},
    streamId: 'tested-1',
    revision: BigInt(index),
    position: { commit: BigInt(index), prepare: BigInt(index) },
  },
});

type FakeSubscription = Readable & {
  unsubscribes: number;
  unsubscribe: () => Promise<void>;
};

const fakeSubscription = (): FakeSubscription => {
  const subscription = new Readable({
    objectMode: true,
    read: () => {},
  }) as FakeSubscription;

  subscription.unsubscribes = 0;
  subscription.unsubscribe = () => {
    subscription.unsubscribes++;
    return Promise.resolve();
  };

  return subscription;
};

const fakeClient = (
  subscription: FakeSubscription,
  options?: { caughtUp?: boolean },
): { client: EventStoreDBClient; subscriptions: () => number } => {
  let subscriptions = 0;

  return {
    subscriptions: () => subscriptions,
    client: {
      subscribeToAll: () => {
        subscriptions++;
        queueMicrotask(() => {
          subscription.emit('confirmation');
          if (options?.caughtUp) subscription.emit('caughtUp');
        });
        return subscription;
      },
    } as unknown as EventStoreDBClient,
  };
};

void describe('eventStoreDBMessageSource', () => {
  void it('delivers available messages in one batch', async () => {
    const subscription = fakeSubscription();
    const { client } = fakeClient(subscription, { caughtUp: true });
    const source = eventStoreDBMessageSource<Tested>({ client, batchSize: 10 });
    const controller = new AbortController();

    subscription.push(resolvedEvent(1));
    subscription.push(resolvedEvent(2));
    subscription.push(resolvedEvent(3));

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      assertEqual(3, batch.messages.length);
      assertEqual(
        ProcessorCheckpoint('0000000000000000003'),
        batch.lastCheckpoint,
      );
      controller.abort();
      break;
    }

    assertEqual(1, subscription.unsubscribes);
  });

  void it('honours the configured batch size', async () => {
    const subscription = fakeSubscription();
    const { client } = fakeClient(subscription, { caughtUp: true });
    const source = eventStoreDBMessageSource<Tested>({ client });
    const controller = new AbortController();

    for (let index = 1; index <= 5; index++)
      subscription.push(resolvedEvent(index));

    const batchSizes: number[] = [];

    for await (const batch of source.read({
      from: 'BEGINNING',
      batchSize: 2,
      signal: controller.signal,
    })) {
      if (batch.messages.some(isGlobalStreamCaughtUp)) {
        controller.abort();
        break;
      }
      batchSizes.push(batch.messages.length);
    }

    assertEqual('2,2,1', batchSizes.join(','));
  });

  void it('reports caught up after reaching the live edge', async () => {
    const subscription = fakeSubscription();
    const { client } = fakeClient(subscription, { caughtUp: true });
    const source = eventStoreDBMessageSource<Tested>({ client });
    const controller = new AbortController();

    subscription.push(resolvedEvent(1));

    let sawCaughtUp = false;

    for await (const batch of source.read({
      from: 'BEGINNING',
      signal: controller.signal,
    })) {
      if (batch.messages.some(isGlobalStreamCaughtUp)) {
        sawCaughtUp = true;
        controller.abort();
        break;
      }
    }

    assertTrue(sawCaughtUp);
  });

  void it('does not report caught up before reaching the live edge', async () => {
    const subscription = fakeSubscription();
    const { client } = fakeClient(subscription);
    const source = eventStoreDBMessageSource<Tested>({ client });
    const controller = new AbortController();
    let reportFirstBatch!: (
      batch: MessageSourceBatch<Tested, EventStoreDBReadEventMetadata>,
    ) => void;
    const firstBatchReceived = new Promise<
      MessageSourceBatch<Tested, EventStoreDBReadEventMetadata>
    >((resolve) => {
      reportFirstBatch = resolve;
    });
    let reportCaughtUp!: () => void;
    const caughtUpReceived = new Promise<void>((resolve) => {
      reportCaughtUp = resolve;
    });
    const reading = (async () => {
      let isFirstBatch = true;

      for await (const batch of source.read({
        from: 'BEGINNING',
        signal: controller.signal,
      })) {
        if (isFirstBatch) {
          isFirstBatch = false;
          reportFirstBatch(batch);
        }

        if (batch.messages.some(isGlobalStreamCaughtUp)) {
          reportCaughtUp();
          return;
        }
      }
    })();

    const ready = await firstBatchReceived;

    assertEqual(0, ready.messages.length);

    let caughtUpReported = false;
    void caughtUpReceived.then(() => {
      caughtUpReported = true;
    });

    await Promise.resolve();
    assertFalse(caughtUpReported);

    subscription.emit('caughtUp');

    await caughtUpReceived;
    assertTrue(caughtUpReported);

    controller.abort();
    await reading;
  });

  void it('receives messages after being stopped and started again', async () => {
    const firstSubscription = fakeSubscription();
    const secondSubscription = fakeSubscription();
    const subscriptions = [firstSubscription, secondSubscription];
    let subscriptionCount = 0;
    const client = {
      subscribeToAll: () => {
        const subscription = subscriptions[subscriptionCount++]!;
        queueMicrotask(() => subscription.emit('confirmation'));
        return subscription;
      },
    } as unknown as EventStoreDBClient;
    const source = eventStoreDBMessageSource<Tested>({ client });

    const startAndStop = async () => {
      const controller = new AbortController();

      for await (const _batch of source.read({
        from: 'BEGINNING',
        signal: controller.signal,
      })) {
        controller.abort();
        break;
      }
    };

    await startAndStop();
    await startAndStop();

    assertEqual(2, subscriptionCount);
    assertEqual(1, firstSubscription.unsubscribes);
    assertEqual(1, secondSubscription.unsubscribes);
  });

  void it('closes the active subscription when stopped', async () => {
    const subscription = fakeSubscription();
    const { client } = fakeClient(subscription);
    const source = eventStoreDBMessageSource<Tested>({ client });
    const controller = new AbortController();
    let reportReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      reportReady = resolve;
    });
    const reading = (async () => {
      for await (const _batch of source.read({
        from: 'BEGINNING',
        signal: controller.signal,
      })) {
        reportReady();
      }
    })();

    await ready;
    controller.abort();
    await reading;

    assertEqual(1, subscription.unsubscribes);
    assertTrue(subscription.destroyed);
  });

  void it('can stop after a connection failure without reconnecting', async () => {
    const subscription = fakeSubscription();
    const { client, subscriptions } = fakeClient(subscription);
    const source = eventStoreDBMessageSource<Tested>({
      client,
      resilience: { resubscribeOptions: NoRetries },
    });
    const controller = new AbortController();
    const failure = new Error('connection closed');

    await assertRejects(
      (async () => {
        for await (const _batch of source.read({
          from: 'BEGINNING',
          signal: controller.signal,
        }))
          subscription.emit('error', failure);
      })(),
      failure,
    );

    assertEqual(1, subscriptions());
    assertEqual(1, subscription.unsubscribes);
    assertTrue(subscription.destroyed);
  });
});
