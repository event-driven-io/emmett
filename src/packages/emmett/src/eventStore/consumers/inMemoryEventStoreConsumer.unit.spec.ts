import { testObservabilityContextGenerator } from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, expectTypeOf, it, vi } from 'vitest';
import type { EmmettError } from '../../errors';
import { getInMemoryDatabase } from '../../database';
import {
  bigIntProcessorCheckpoint,
  MessageProcessorType,
  type MessageProcessor,
} from '../../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertNotEqual,
  assertThatArray,
  assertThrowsAsync,
  assertTrue,
} from '../../testing';
import type { AnyMessage, Event, ReadEvent } from '../../typing';
import { WorkflowHandler, workflowStreamName } from '../../workflows';
import {
  GroupCheckoutWorkflow,
  type GroupCheckout,
  type GroupCheckoutInput,
  type GroupCheckoutOutput,
  type InitiateGroupCheckout,
  workflowOptions,
} from '../../workflows/workflow.testHelpers';
import {
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '../inMemoryEventStore';
import { inMemorySingleStreamProjection } from '../projections';
import type { InMemoryEventStoreConsumer } from './inMemoryEventStoreConsumer';

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;
type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type CheckpointDocument = {
  _id: string;
  lastCheckpoint: string | null;
  _version?: bigint;
};

const withDeadline = { timeout: 30000 };

void describe('In-memory event store consumer', () => {
  const dummyProcessor: MessageProcessor = {
    type: MessageProcessorType.REACTOR,
    id: uuid(),
    instanceId: uuid(),
    init: () => Promise.resolve(),
    start: () => Promise.resolve('BEGINNING'),
    close: () => Promise.resolve(),
    handle: () => Promise.resolve(),
    isActive: false,
    whenProcessed: () => Promise.resolve(),
  };

  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
  });

  const guestStay = () => {
    const guestId = uuid();
    const streamName = `guestStay-${guestId}`;
    const events: GuestStayEvent[] = [
      { type: 'GuestCheckedIn', data: { guestId } },
      { type: 'GuestCheckedOut', data: { guestId } },
    ];
    return { guestId, streamName, events };
  };

  const collectingReactor = (
    consumer: InMemoryEventStoreConsumer,
    processorId: string = uuid(),
  ) => {
    const received: ReadEvent<GuestStayEvent>[] = [];
    consumer.reactor<GuestStayEvent>({
      processorId,
      eachMessage: (event) => {
        received.push(event);
      },
    });
    return received;
  };

  void it('creates not-started consumer for the event store', () => {
    const consumer = eventStore.consumer({ processors: [dummyProcessor] });

    assertFalse(consumer.isRunning);
  });

  void it('event store returns a not-started consumer with reactor, projector and workflowProcessor', () => {
    const consumer = eventStore.consumer();

    assertFalse(consumer.isRunning);
    assertEqual(typeof consumer.reactor, 'function');
    assertEqual(typeof consumer.projector, 'function');
    assertEqual(typeof consumer.workflowProcessor, 'function');
    assertThatArray([...consumer.processors]).isEmpty();
  });

  void it('event store returns the strongly typed in-memory consumer', () => {
    expectTypeOf(eventStore.consumer()).toEqualTypeOf<
      InMemoryEventStoreConsumer<AnyMessage>
    >();
  });

  void describe('created consumer', () => {
    let consumer: InMemoryEventStoreConsumer;

    beforeEach(() => {
      consumer = eventStore.consumer({ processors: [dummyProcessor] });
    });

    afterEach(() => consumer.stop());

    void it('fails to start if there are no processors', async () => {
      const consumerWithoutProcessors = eventStore.consumer({
        processors: [],
      });

      await assertThrowsAsync<EmmettError>(
        () => consumerWithoutProcessors.start(),
        (error) =>
          error.message ===
          'Cannot start consumer without at least a single processor',
      );
      await assertThrowsAsync<EmmettError>(
        () => consumerWithoutProcessors.whenStarted(),
        (error) =>
          error.message ===
          'Cannot start consumer without at least a single processor',
      );
    });

    void it('whenStarted resolves after successful start', async () => {
      const startedConsumer = eventStore.consumer({
        processors: [dummyProcessor],
      });
      try {
        void startedConsumer.start();
        await startedConsumer.whenStarted();
        assertTrue(startedConsumer.isRunning);
      } finally {
        await startedConsumer.stop();
      }
    });

    void it('whenStarted rejects if there are no processors', async () => {
      const consumerWithoutProcessors = eventStore.consumer({
        processors: [],
      });
      try {
        consumerWithoutProcessors.start().catch(() => {});

        await assertThrowsAsync<EmmettError>(
          () => consumerWithoutProcessors.whenStarted(),
          (error) =>
            error.message ===
            'Cannot start consumer without at least a single processor',
        );
      } finally {
        await consumerWithoutProcessors.stop();
      }
    });

    void it(`stopping not started consumer doesn't fail`, async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });

    void it(`stopping not started consumer is idempotent`, async () => {
      await consumer.stop();
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });

  void describe('started consumer', () => {
    let consumer: InMemoryEventStoreConsumer;

    beforeEach(async () => {
      consumer = eventStore.consumer({ processors: [dummyProcessor] });
      void consumer.start();
      await consumer.whenStarted();
    });
    afterEach(() => consumer.stop());

    void it('stops started consumer', async () => {
      await consumer.stop();

      assertFalse(consumer.isRunning);
    });
  });

  void it(
    'stopping a started consumer resolves start and stops delivery',
    withDeadline,
    async () => {
      const stopped = eventStore.consumer();
      const stoppedReceived = collectingReactor(stopped);
      const running = eventStore.consumer();
      const runningReceived = collectingReactor(running);

      const runningPromise = running.start();
      try {
        const stoppedPromise = stopped.start();
        await Promise.all([stopped.whenStarted(), running.whenStarted()]);

        await stopped.stop();
        await stoppedPromise;

        const { streamName, events } = guestStay();
        const result = await eventStore.appendToStream(streamName, events);
        await running.whenProcessed(result.lastEventGlobalPosition);

        const { events: stored } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        assertDeepEqual(runningReceived, stored);
        assertThatArray(stoppedReceived).isEmpty();
      } finally {
        await stopped.close();
        await running.close();
        await runningPromise;
      }
    },
  );

  void it(
    'stopWhen noMessagesLeft stops after the log is processed',
    withDeadline,
    async () => {
      const { streamName, events } = guestStay();
      await eventStore.appendToStream(streamName, events);

      const consumer = eventStore.consumer({
        stopWhen: { noMessagesLeft: true },
      });
      const received = collectingReactor(consumer);

      try {
        await consumer.start();

        const { events: stored } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        assertDeepEqual(received, stored);
        assertFalse(consumer.isRunning);
      } finally {
        await consumer.close();
      }
    },
  );

  void it('closing the store consumer twice does not fail', async () => {
    const consumer = eventStore.consumer();
    collectingReactor(consumer);

    const consumerPromise = consumer.start();
    await consumer.whenStarted();

    await consumer.close();
    await consumer.close();
    await consumerPromise;

    assertFalse(consumer.isRunning);
  });

  void describe('appends while consuming', () => {
    void it(
      'events appended between creating and starting the consumer arrive once',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const first = guestStay();
        const second = guestStay();

        await eventStore.appendToStream(first.streamName, first.events);

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          const result = await eventStore.appendToStream(
            second.streamName,
            second.events,
          );
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: firstStored } =
            await eventStore.readStream<GuestStayEvent>(first.streamName);
          const { events: secondStored } =
            await eventStore.readStream<GuestStayEvent>(second.streamName);
          assertDeepEqual(received, [...firstStored, ...secondStored]);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'a restarted consumer continues after the events it already processed',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const first = guestStay();
        const second = guestStay();

        let consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();
          const firstResult = await eventStore.appendToStream(
            first.streamName,
            first.events,
          );
          await consumer.whenProcessed(firstResult.lastEventGlobalPosition);

          await consumer.stop();
          await consumerPromise;

          const secondResult = await eventStore.appendToStream(
            second.streamName,
            second.events,
          );
          consumerPromise = consumer.start();
          await consumer.whenStarted();
          await consumer.whenProcessed(secondResult.lastEventGlobalPosition);

          const { events: firstStored } =
            await eventStore.readStream<GuestStayEvent>(first.streamName);
          const { events: secondStored } =
            await eventStore.readStream<GuestStayEvent>(second.streamName);
          assertDeepEqual(received, [...firstStored, ...secondStored]);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'a reactor appending many times to the same store does not block the consumer',
      withDeadline,
      async () => {
        const appends = 150;
        const consumer = eventStore.consumer();
        const received: ReadEvent<GuestStayEvent>[] = [];
        const { guestId, streamName } = guestStay();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: async (event) => {
            received.push(event);
            if (event.type !== 'GuestCheckedIn') return;

            for (let append = 0; append < appends; append++)
              await eventStore.appendToStream(streamName, [
                { type: 'GuestCheckedOut', data: { guestId } },
              ]);
          },
        });

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);
          await consumer.whenProcessed(
            bigIntProcessorCheckpoint(BigInt(appends + 1)),
          );

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(received, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'closing one consumer keeps delivering to the others',
      withDeadline,
      async () => {
        const closed = eventStore.consumer();
        collectingReactor(closed);
        const running = eventStore.consumer();
        const runningReceived = collectingReactor(running);

        const closedPromise = closed.start();
        const runningPromise = running.start();
        try {
          await Promise.all([closed.whenStarted(), running.whenStarted()]);

          await closed.close();
          await closedPromise;

          const { streamName, events } = guestStay();
          const result = await eventStore.appendToStream(streamName, events);
          await running.whenProcessed(result.lastEventGlobalPosition);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(runningReceived, stored);
        } finally {
          await running.close();
          await runningPromise;
        }
      },
    );
  });

  void describe('append result', () => {
    void it(
      'append returns lastEventGlobalPosition',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          const result = await eventStore.appendToStream(streamName, events);

          assertDeepEqual(result, {
            nextExpectedStreamVersion: 2n,
            lastEventGlobalPosition: bigIntProcessorCheckpoint(2n),
            createdNewStream: true,
          });

          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(received, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'each concurrent append returns the global position of its own last event',
      withDeadline,
      async () => {
        const slowStore = getInMemoryEventStore({
          projections: [
            {
              type: 'inline',
              projection: {
                name: 'slow',
                canHandle: ['GuestCheckedIn'],
                handle: () => new Promise((resolve) => setTimeout(resolve, 10)),
              },
            },
          ],
        });
        const first = guestStay();
        const second = guestStay();

        const [firstResult, secondResult] = await Promise.all([
          slowStore.appendToStream(first.streamName, [first.events[0]!]),
          slowStore.appendToStream(second.streamName, [second.events[0]!]),
        ]);

        const { events: firstStored } = await slowStore.readStream(
          first.streamName,
        );
        const { events: secondStored } = await slowStore.readStream(
          second.streamName,
        );
        assertEqual(
          firstResult.lastEventGlobalPosition,
          firstStored[0]!.metadata.checkpoint,
        );
        assertEqual(
          secondResult.lastEventGlobalPosition,
          secondStored[0]!.metadata.checkpoint,
        );
        assertNotEqual(
          firstResult.lastEventGlobalPosition,
          secondResult.lastEventGlobalPosition,
        );
      },
    );

    void it('global positions keep increasing across streams after many appends', async () => {
      const positions: string[] = [];

      for (let i = 0; i < 10; i++) {
        const { streamName, events } = guestStay();
        const result = await eventStore.appendToStream(
          streamName,
          events.slice(0, 1),
        );
        positions.push(result.lastEventGlobalPosition);
      }

      assertDeepEqual(
        positions,
        Array.from({ length: 10 }, (_, i) =>
          bigIntProcessorCheckpoint(BigInt(i + 1)),
        ),
      );
    });

    void it('global positions follow the append order across streams', async () => {
      const first = guestStay();
      const second = guestStay();

      const firstResult = await eventStore.appendToStream(
        first.streamName,
        first.events,
      );
      const secondResult = await eventStore.appendToStream(
        second.streamName,
        second.events,
      );
      const thirdResult = await eventStore.appendToStream(first.streamName, [
        first.events[0]!,
      ]);

      const { events: firstStored } = await eventStore.readStream(
        first.streamName,
      );
      const { events: secondStored } = await eventStore.readStream(
        second.streamName,
      );
      assertDeepEqual(
        [
          firstResult.lastEventGlobalPosition,
          secondResult.lastEventGlobalPosition,
          thirdResult.lastEventGlobalPosition,
        ],
        [
          bigIntProcessorCheckpoint(2n),
          bigIntProcessorCheckpoint(4n),
          bigIntProcessorCheckpoint(5n),
        ],
      );
      assertDeepEqual(
        firstStored.map((event) => event.metadata.globalPosition),
        [1n, 2n, 5n].map(bigIntProcessorCheckpoint),
      );
      assertDeepEqual(
        secondStored.map((event) => event.metadata.globalPosition),
        [3n, 4n].map(bigIntProcessorCheckpoint),
      );
    });
  });

  void describe('reactor', () => {
    void it(
      'messages carry stream and global metadata across streams',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const first = guestStay();
        const second = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          await eventStore.appendToStream(first.streamName, [first.events[0]!]);
          await eventStore.appendToStream(second.streamName, second.events);
          await eventStore.appendToStream(first.streamName, [first.events[1]!]);

          await consumer.whenCaughtUp();

          const { events: firstStored } =
            await eventStore.readStream<GuestStayEvent>(first.streamName);
          const { events: secondStored } =
            await eventStore.readStream<GuestStayEvent>(second.streamName);

          const expected = (
            stored: ReadEvent<GuestStayEvent>,
            event: GuestStayEvent,
            streamName: string,
            streamPosition: bigint,
            globalPosition: bigint,
          ) => ({
            ...event,
            kind: 'Event' as const,
            schemaVersion: 1 as const,
            metadata: {
              streamName,
              messageId: stored.metadata.messageId,
              streamPosition,
              globalPosition: bigIntProcessorCheckpoint(globalPosition),
              checkpoint: bigIntProcessorCheckpoint(globalPosition),
              correlationId: stored.metadata.correlationId,
              causationId: stored.metadata.causationId,
              traceId: stored.metadata.traceId,
              spanId: stored.metadata.spanId,
            },
          });

          assertDeepEqual(received, [
            expected(
              firstStored[0]!,
              first.events[0]!,
              first.streamName,
              1n,
              1n,
            ),
            expected(
              secondStored[0]!,
              second.events[0]!,
              second.streamName,
              1n,
              2n,
            ),
            expected(
              secondStored[1]!,
              second.events[1]!,
              second.streamName,
              2n,
              3n,
            ),
            expected(
              firstStored[1]!,
              first.events[1]!,
              first.streamName,
              2n,
              4n,
            ),
          ]);
          assertEqual(
            new Set(received.map((event) => event.metadata.messageId)).size,
            4,
          );
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'reactor receives the downcast stored form',
      withDeadline,
      async () => {
        type GuestCheckedInV2 = Event<
          'GuestCheckedIn',
          { guestId: string; roomId: string }
        >;
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          const result = await eventStore.appendToStream<
            GuestCheckedInV2,
            GuestCheckedIn
          >(
            streamName,
            [{ type: 'GuestCheckedIn', data: { guestId, roomId: '101' } }],
            {
              schema: {
                versioning: {
                  downcast: (event) => ({
                    type: 'GuestCheckedIn',
                    data: { guestId: event.data.guestId },
                  }),
                },
              },
            },
          );
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(received, stored);
          assertDeepEqual(received[0]!.data, { guestId });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'reactor receives the schema version the same way as readStream',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const { guestId, streamName } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          const result = await eventStore.appendToStream<GuestCheckedIn>(
            streamName,
            [{ type: 'GuestCheckedIn', data: { guestId } }],
            {
              schema: {
                versioning: {
                  downcast: (event) => ({
                    ...event,
                    metadata: { schemaVersion: 2 },
                  }),
                },
              },
            },
          );
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(received, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'reactor changing top-level fields or metadata of a received message does not change the stored stream',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            Object.assign(event, { type: 'Tampered' });
            Object.assign(event.metadata, { streamName: 'tampered' });
          },
        });
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          const result = await eventStore.appendToStream(streamName, events);
          const { events: beforeHandling } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: afterHandling } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(afterHandling, beforeHandling);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'events of an append whose inline projection threw still reach the consumer',
      withDeadline,
      async () => {
        const failingStore = getInMemoryEventStore({
          projections: [
            {
              type: 'inline',
              projection: {
                name: 'failing',
                canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
                handle: () => {
                  throw new Error('Projection failed');
                },
              },
            },
          ],
        });
        const consumer = failingStore.consumer();
        const received = collectingReactor(consumer);
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          await assertThrowsAsync(() =>
            failingStore.appendToStream(streamName, events),
          );

          await consumer.whenCaughtUp();

          const { events: stored } =
            await failingStore.readStream<GuestStayEvent>(streamName);
          assertThatArray(stored).hasSize(2);
          assertDeepEqual(received, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'an append that fails the expected-version check reaches no consumer',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();

          await assertThrowsAsync(() =>
            eventStore.appendToStream(streamName, events, {
              expectedStreamVersion: 5n,
            }),
          );
          const result = await eventStore.appendToStream(streamName, [
            events[0]!,
          ]);
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertThatArray(stored).hasSize(1);
          assertDeepEqual(received, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'reactor checkpoint lives in the store database',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const processorId = uuid();
        collectingReactor(consumer, processorId);
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();
          const result = await eventStore.appendToStream(streamName, events);
          await consumer.whenProcessed(result.lastEventGlobalPosition);

          const checkpoint = await eventStore.database
            .collection<CheckpointDocument>('emt_processor_checkpoints')
            .findOne((d) => d._id === processorId);

          assertDeepEqual(checkpoint, {
            _id: processorId,
            lastCheckpoint: result.lastEventGlobalPosition,
            _version: 1n,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('batching', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    void it('batch size limits eachBatch', withDeadline, async () => {
      const consumer = eventStore.consumer({ pulling: { batchSize: 2 } });
      const batches: ReadEvent<GuestStayEvent>[][] = [];
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        eachBatch: (messages) => {
          batches.push([...messages]);
        },
      });
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = Array.from({ length: 5 }, () => ({
        type: 'GuestCheckedIn',
        data: { guestId },
      }));
      await eventStore.appendToStream(streamName, events);

      const consumerPromise = consumer.start();
      try {
        await consumer.whenCaughtUp();

        const { events: stored } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        assertTrue(batches.every((batch) => batch.length <= 2));
        assertDeepEqual(batches.flat(), stored);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    });

    void it(
      'batch deadline flushes a partial batch',
      withDeadline,
      async () => {
        vi.useFakeTimers();

        const consumer = eventStore.consumer({
          pulling: { batchSize: 10, batchDeadlineInMs: 20 },
        });
        const batches: ReadEvent<GuestStayEvent>[][] = [];
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachBatch: (messages) => {
            batches.push([...messages]);
          },
        });
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
          { type: 'GuestCheckedIn', data: { guestId } },
        ];

        const consumerPromise = consumer.start();
        try {
          await consumer.whenStarted();
          await eventStore.appendToStream(streamName, events);

          await vi.advanceTimersByTimeAsync(20);

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(batches, [stored]);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('whenCaughtUp', () => {
    void it(
      'whenCaughtUp resolves after processing, and again after more appends',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        const received = collectingReactor(consumer);
        const first = guestStay();
        const second = guestStay();

        const consumerPromise = consumer.start();
        try {
          await eventStore.appendToStream(first.streamName, first.events);
          await consumer.whenCaughtUp();

          const { events: firstStored } =
            await eventStore.readStream<GuestStayEvent>(first.streamName);
          assertDeepEqual(received, firstStored);

          await eventStore.appendToStream(second.streamName, second.events);
          await consumer.whenCaughtUp();

          const { events: secondStored } =
            await eventStore.readStream<GuestStayEvent>(second.streamName);
          assertDeepEqual(received, [...firstStored, ...secondStored]);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('projector', () => {
    type GuestSummary = {
      _id?: string;
      _version?: bigint;
      checkIns: number;
      checkOuts: number;
    };

    const guestSummaryProjection = inMemorySingleStreamProjection({
      collectionName: 'guestSummaries',
      canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
      initialState: (): GuestSummary => ({ checkIns: 0, checkOuts: 0 }),
      evolve: (
        document: GuestSummary,
        { type }: ReadEvent<GuestStayEvent>,
      ): GuestSummary =>
        type === 'GuestCheckedIn'
          ? { ...document, checkIns: document.checkIns + 1 }
          : { ...document, checkOuts: document.checkOuts + 1 },
    });

    void it(
      'projector on the store consumer updates the read model in the store database',
      withDeadline,
      async () => {
        const consumer = eventStore.consumer();
        consumer.projector<GuestStayEvent>({
          processorId: uuid(),
          projection: guestSummaryProjection,
        });
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await eventStore.appendToStream(streamName, events);
          await consumer.whenCaughtUp();

          const summary = await eventStore.database
            .collection<GuestSummary>('guestSummaries')
            .findOne((d) => d._id === streamName);

          assertDeepEqual(summary, {
            _id: streamName,
            _version: 2n,
            checkIns: 1,
            checkOuts: 1,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'a projector with its own database writes there, not to the store database',
      withDeadline,
      async () => {
        const ownDatabase = getInMemoryDatabase();
        const consumer = eventStore.consumer();
        consumer.projector<GuestStayEvent>({
          processorId: uuid(),
          projection: guestSummaryProjection,
          connectionOptions: { database: ownDatabase },
        });
        const { streamName, events } = guestStay();

        const consumerPromise = consumer.start();
        try {
          await eventStore.appendToStream(streamName, events);
          await consumer.whenCaughtUp();

          const own = await ownDatabase
            .collection<GuestSummary>('guestSummaries')
            .findOne((d) => d._id === streamName);
          const inStore = await eventStore.database
            .collection<GuestSummary>('guestSummaries')
            .findOne((d) => d._id === streamName);

          assertDeepEqual(own, {
            _id: streamName,
            _version: 2n,
            checkIns: 1,
            checkOuts: 1,
          });
          assertEqual(inStore, null);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });

  void describe('workflow processor', () => {
    const now = new Date();
    const initiateGroupCheckout = (
      groupCheckoutId: string,
      guestId: string,
    ): InitiateGroupCheckout => ({
      type: 'InitiateGroupCheckout',
      kind: 'Command',
      data: {
        groupCheckoutId,
        clerkId: 'clerk-1',
        guestStayAccountIds: [guestId],
        now,
      },
    });
    const handleWorkflow = WorkflowHandler({
      ...workflowOptions,
      separateInputInboxFromProcessing: true,
    });

    void it(
      'workflow output is appended to the same in-memory store',
      withDeadline,
      async () => {
        const groupCheckoutId = uuid();
        const guestId = uuid();
        const inputMessageId = uuid();
        const storedMessageIds = [uuid(), uuid(), uuid()];
        const [storedInputMessageId] = storedMessageIds;
        const correlationId = uuid();
        const handlerTrace = { traceId: uuid(), spanId: uuid() };
        const processorTrace = { traceId: uuid(), spanId: uuid() };
        const store = getInMemoryEventStore({
          observability: {
            contextGenerator: testObservabilityContextGenerator({
              traceIds: uuid(),
              spanIds: uuid(),
              messageIds: storedMessageIds,
            }),
          },
        });
        const consumer = store.consumer();
        consumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...workflowOptions,
          separateInputInboxFromProcessing: true,
          processorId: uuid(),
          observability: {
            contextGenerator: testObservabilityContextGenerator({
              traceIds: processorTrace.traceId,
              spanIds: processorTrace.spanId,
            }),
          },
        });

        const consumerPromise = consumer.start();
        try {
          await WorkflowHandler({
            ...workflowOptions,
            separateInputInboxFromProcessing: true,
            observability: {
              contextGenerator: testObservabilityContextGenerator({
                traceIds: handlerTrace.traceId,
                spanIds: handlerTrace.spanId,
                messageIds: inputMessageId,
                correlationIds: correlationId,
              }),
            },
          })(store, initiateGroupCheckout(groupCheckoutId, guestId));
          await consumer.whenCaughtUp();

          const workflowStream = workflowStreamName({
            workflowName: GroupCheckoutWorkflow.name,
            workflowId: groupCheckoutId,
          });
          const { events: output } = await store.readStream(workflowStream);

          const stored = (
            index: number,
            type: string,
            kind: 'Command' | 'Event',
            data: unknown,
            metadata: Record<string, unknown>,
          ) => {
            const globalPosition = bigIntProcessorCheckpoint(BigInt(index + 1));
            return {
              type,
              data,
              kind,
              schemaVersion: 1,
              metadata: {
                ...metadata,
                streamName: workflowStream,
                messageId: storedMessageIds[index],
                streamPosition: BigInt(index + 1),
                globalPosition,
                checkpoint: globalPosition,
                correlationId,
              },
            };
          };

          assertDeepEqual<unknown>(output, [
            stored(
              0,
              'GroupCheckoutWorkflow:InitiateGroupCheckout',
              'Command',
              {
                groupCheckoutId,
                clerkId: 'clerk-1',
                guestStayAccountIds: [guestId],
                now,
              },
              {
                originalMessageId: inputMessageId,
                input: true,
                action: 'InitiatedBy',
                causationId: inputMessageId,
                ...handlerTrace,
              },
            ),
            stored(
              1,
              'GroupCheckoutInitiated',
              'Event',
              {
                groupCheckoutId,
                guestStayAccountIds: [guestId],
                initiatedAt: now,
                clerkId: 'clerk-1',
              },
              {
                action: 'Published',
                causationId: storedInputMessageId,
                ...processorTrace,
              },
            ),
            stored(
              2,
              'CheckOut',
              'Command',
              { guestStayAccountId: guestId, groupCheckoutId },
              {
                now,
                action: 'Sent',
                causationId: storedInputMessageId,
                ...processorTrace,
              },
            ),
          ]);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'workflow checkpoint is stored in the store database',
      withDeadline,
      async () => {
        const groupCheckoutId = uuid();
        const processorId = uuid();
        const consumer = eventStore.consumer();
        consumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...workflowOptions,
          separateInputInboxFromProcessing: true,
          processorId,
        });

        const consumerPromise = consumer.start();
        try {
          await handleWorkflow(
            eventStore,
            initiateGroupCheckout(groupCheckoutId, uuid()),
          );
          await consumer.whenCaughtUp();

          const checkpoint = await eventStore.database
            .collection<CheckpointDocument>('emt_processor_checkpoints')
            .findOne((d) => d._id === processorId);

          assertDeepEqual(checkpoint, {
            _id: processorId,
            lastCheckpoint: bigIntProcessorCheckpoint(1n),
            _version: 1n,
          });
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'workflow checkpoint is not stored when checkpoints are DISABLED',
      withDeadline,
      async () => {
        const groupCheckoutId = uuid();
        const processorId = uuid();
        const consumer = eventStore.consumer();
        consumer.workflowProcessor<
          GroupCheckoutInput,
          GroupCheckout,
          GroupCheckoutOutput
        >({
          ...workflowOptions,
          separateInputInboxFromProcessing: true,
          processorId,
          checkpoints: 'DISABLED',
        });

        const consumerPromise = consumer.start();
        try {
          await handleWorkflow(
            eventStore,
            initiateGroupCheckout(groupCheckoutId, uuid()),
          );
          await consumer.whenCaughtUp();

          const checkpoint = await eventStore.database
            .collection<CheckpointDocument>('emt_processor_checkpoints')
            .findOne((d) => d._id === processorId);

          assertEqual(checkpoint, null);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });
});
