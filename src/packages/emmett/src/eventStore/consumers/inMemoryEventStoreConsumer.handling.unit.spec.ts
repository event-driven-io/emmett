import {
  collectingTracer,
  ObservabilitySpec,
  type LogEvent,
} from '@event-driven-io/almanac';
import { v4 as uuid } from 'uuid';
import { beforeEach, describe, it, vi } from 'vitest';
import { EmmettAttributes, EmmettSpans } from '../../observability';
import type {
  InMemoryProjectorOptions,
  InMemoryReactorOptions,
} from '../../processors';
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertThatArray,
} from '../../testing';
import type { Event } from '../../typing';
import {
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '../inMemoryEventStore';

const withDeadline = { timeout: 30000 };

void describe('In-memory event store started consumer', () => {
  let eventStore: InMemoryEventStore;

  const collectingProjection = (
    collected: GuestStayEvent[],
    projectionName: string,
  ): InMemoryProjectorOptions<GuestStayEvent>['projection'] => ({
    name: projectionName,
    canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
    handle: (events) => {
      collected.push(...events);
    },
  });

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
  });

  void describe('starting and closing resilience', () => {
    void it(
      'handles close being called while start is initializing without race condition',
      withDeadline,
      async () => {
        const iterations = 10;
        const errors: Error[] = [];

        await eventStore.appendToStream(`testStream-${uuid()}`, [
          { type: 'TestEvent', data: {} },
        ]);

        await Promise.all(
          Array.from({ length: iterations }, async () => {
            const consumer = eventStore.consumer();

            consumer.reactor<GuestStayEvent>({
              processorId: uuid(),
              eachMessage: () => {},
              stopAfter: () => true,
            });

            try {
              const startPromise = consumer.start();
              //await consumer.close();
              await startPromise;
            } catch (error) {
              errors.push(error as Error);
            } finally {
              await consumer.close();
            }
          }),
        );

        assertThatArray(errors).hasSize(0);
      },
    );
  });

  void describe('consumer created by the event store', () => {
    void it(
      'catches up with events appended before it was created',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, events);

        const projected: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.projector<GuestStayEvent>({
          processorId: uuid(),
          projection: collectingProjection(projected, `guestStays-${uuid()}`),
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenCaughtUp();

          // Then
          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(projected, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'leaves the event store usable after the consumer was closed',
      withDeadline,
      async () => {
        // Given
        const ownedStore = getInMemoryEventStore();

        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const consumer = ownedStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: () => {},
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();
        } finally {
          await consumer.close();
          await consumerPromise;
        }

        // When
        await ownedStore.appendToStream(streamName, [
          { type: 'GuestCheckedIn', data: { guestId } },
        ]);

        // Then
        const { events: read } =
          await ownedStore.readStream<GuestStayEvent>(streamName);
        assertThatArray(read).hasSize(1);
      },
    );

    void it(
      'returns distinct consumers with separate checkpoints',
      withDeadline,
      async () => {
        // Given
        const first = eventStore.consumer();
        const second = eventStore.consumer();

        assertNotEqual(first.consumerId, second.consumerId);

        const firstResult: GuestStayEvent[] = [];
        const secondResult: GuestStayEvent[] = [];

        first.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            firstResult.push(event);
          },
        });
        second.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            secondResult.push(event);
          },
        });

        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];

        let firstPromise: Promise<void> | undefined;
        let secondPromise: Promise<void> | undefined;
        try {
          // When
          firstPromise = first.start();
          secondPromise = second.start();
          await Promise.all([first.whenStarted(), second.whenStarted()]);

          await eventStore.appendToStream(streamName, events);

          await Promise.all([first.whenCaughtUp(), second.whenCaughtUp()]);

          // Then
          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(firstResult, stored);
          assertDeepEqual(secondResult, stored);

          // And closing the first one keeps the second one consuming
          await first.close();
          await firstPromise;
          firstPromise = undefined;

          const otherGuestId = uuid();
          const newEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          ];
          await eventStore.appendToStream(
            `guestStay-${otherGuestId}`,
            newEvents,
          );

          await second.whenCaughtUp();

          const { events: newStored } =
            await eventStore.readStream<GuestStayEvent>(
              `guestStay-${otherGuestId}`,
            );
          assertDeepEqual(secondResult, [...stored, ...newStored]);
        } finally {
          await first.close();
          await firstPromise;
          await second.close();
          await secondPromise;
        }
      },
    );
  });

  void describe('observability', () => {
    const given = ObservabilitySpec.for();

    const appendGuestCheckedIn = () => {
      const guestId = uuid();
      return eventStore.appendToStream(`guestStay-${guestId}`, [
        { type: 'GuestCheckedIn', data: { guestId } },
      ]);
    };

    void it(
      'processor lifecycle logs and spans reach the configured observability',
      withDeadline,
      async () => {
        const processorId = uuid();
        const { lastEventGlobalPosition } = await appendGuestCheckedIn();

        await given((observability) => {
          const consumer = eventStore.consumer({ observability });
          consumer.reactor<GuestStayEvent>({
            processorId,
            stopAfter: (event) =>
              event.metadata.globalPosition === lastEventGlobalPosition,
            eachMessage: () => {},
          });
          return consumer;
        })
          .when((consumer) => consumer.start())
          .then(({ spans }) => {
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.start)
              .hasParentSpanNamed(EmmettSpans.consumer.start)
              .logged('info', 'Processor started', {
                [EmmettAttributes.processor.id]: processorId,
              });
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.close)
              .hasParentSpanNamed(EmmettSpans.consumer.stop)
              .logged('info', 'Processor stopped', {
                [EmmettAttributes.processor.id]: processorId,
              });
          });
      },
    );

    void it(
      "a consumer created from an event store logs through the store's observability",
      withDeadline,
      async () => {
        const processorId = uuid();

        await given(async (observability) => {
          const storeWithOwnLogger = getInMemoryEventStore({ observability });
          const guestId = uuid();
          const { lastEventGlobalPosition } =
            await storeWithOwnLogger.appendToStream(`guestStay-${guestId}`, [
              { type: 'GuestCheckedIn', data: { guestId } },
            ]);
          const consumer = storeWithOwnLogger.consumer();
          consumer.reactor<GuestStayEvent>({
            processorId,
            stopAfter: (event) =>
              event.metadata.globalPosition === lastEventGlobalPosition,
            eachMessage: () => {},
          });
          return consumer;
        })
          .when((consumer) => consumer.start())
          .then(({ spans }) => {
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.start)
              .logged('info', 'Processor started', {
                [EmmettAttributes.processor.id]: processorId,
              });
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.close)
              .logged('info', 'Processor stopped', {
                [EmmettAttributes.processor.id]: processorId,
              });
          });
      },
    );

    void it(
      "a consumer's own observability wins over the store's",
      withDeadline,
      async () => {
        const processorId = uuid();
        const storeLogs: LogEvent[] = [];
        const storeTracer = collectingTracer();
        let storeSpanNamesBeforeStart: string[] = [];

        await given(async (observability) => {
          const storeWithOwnLogger = getInMemoryEventStore({
            observability: {
              tracer: storeTracer,
              logger: (log) => storeLogs.push(log),
            },
          });
          const guestId = uuid();
          const { lastEventGlobalPosition } =
            await storeWithOwnLogger.appendToStream(`guestStay-${guestId}`, [
              { type: 'GuestCheckedIn', data: { guestId } },
            ]);
          storeSpanNamesBeforeStart = storeTracer.spans.map((s) => s.name);
          const consumer = storeWithOwnLogger.consumer({ observability });
          consumer.reactor<GuestStayEvent>({
            processorId,
            stopAfter: (event) =>
              event.metadata.globalPosition === lastEventGlobalPosition,
            eachMessage: () => {},
          });
          return consumer;
        })
          .when((consumer) => consumer.start())
          .then(({ spans }) => {
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.start)
              .logged('info', 'Processor started', {
                [EmmettAttributes.processor.id]: processorId,
              });
            spans
              .hasSingleSpanNamed(EmmettSpans.processor.close)
              .logged('info', 'Processor stopped', {
                [EmmettAttributes.processor.id]: processorId,
              });
          });

        assertDeepEqual(
          storeTracer.spans.map((s) => s.name),
          storeSpanNamesBeforeStart,
        );
        assertDeepEqual(storeLogs, []);
      },
    );

    void it(
      'a consumer with no observability configured logs nothing',
      withDeadline,
      async () => {
        const { lastEventGlobalPosition } = await appendGuestCheckedIn();
        const outputs = [
          vi.spyOn(console, 'log').mockImplementation(() => {}),
          vi.spyOn(console, 'info').mockImplementation(() => {}),
          vi.spyOn(console, 'warn').mockImplementation(() => {}),
          vi.spyOn(console, 'error').mockImplementation(() => {}),
          vi.spyOn(console, 'debug').mockImplementation(() => {}),
          vi.spyOn(process.stdout, 'write').mockImplementation(() => true),
          vi.spyOn(process.stderr, 'write').mockImplementation(() => true),
        ];
        let calls: number | undefined;

        try {
          const consumer = eventStore.consumer();
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            stopAfter: (event) =>
              event.metadata.globalPosition === lastEventGlobalPosition,
            eachMessage: () => {},
          });
          try {
            await consumer.start();
          } finally {
            await consumer.close();
          }
          calls = outputs.reduce((sum, o) => sum + o.mock.calls.length, 0);
        } finally {
          outputs.forEach((o) => o.mockRestore());
        }

        assertEqual(calls, 0);
      },
    );
  });

  void describe('eachMessage', () => {
    void it(
      'handles all events appended to event store BEFORE processor was started',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        const appendResult = await eventStore.appendToStream(
          streamName,
          events,
        );
        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer.start();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'handles all events appended to event store AFTER processor was started',
      withDeadline,
      async () => {
        // Given

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            result.push(event);
          },
        });

        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles ONLY events AFTER provided global position',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: {
            lastCheckpoint: startPosition,
          },
          eachMessage: (event) => {
            result.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored.slice(initialEvents.length));
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles all events when CURRENT position is NOT stored',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];

        await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void describe('startFrom END across processors in one consumer', () => {
      void it(
        'does not flood END processor when mixed with BEGINNING processor in one consumer',
        withDeadline,
        async () => {
          // Given
          const guestId = uuid();
          const otherGuestId = uuid();
          const streamName = `guestStay-${guestId}`;

          const initialEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];
          await eventStore.appendToStream(streamName, initialEvents);

          const newEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];

          const fromBeginning: GuestStayEvent[] = [];
          const fromEnd: GuestStayEvent[] = [];

          // When
          const consumer = eventStore.consumer();
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'BEGINNING',
            eachMessage: (event) => {
              fromBeginning.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              fromEnd.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

            // Then the BEGINNING processor sees the whole history,
            // while the END processor sees only messages appended after start
            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(fromBeginning, stored);
            assertDeepEqual(fromEnd, stored.slice(initialEvents.length));
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );

      void it(
        'resumes a checkpointed projection from its checkpoint while an END reactor sees only new events',
        withDeadline,
        async () => {
          const guestId = uuid();
          const otherGuestId = uuid();
          const streamName = `guestStay-${guestId}`;

          const initialEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];
          const { lastEventGlobalPosition: resumeCheckpoint } =
            await eventStore.appendToStream(streamName, initialEvents);

          const backlogEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];
          await eventStore.appendToStream(streamName, backlogEvents);

          const newEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];

          const fromResuming: GuestStayEvent[] = [];
          const fromEnd: GuestStayEvent[] = [];

          const consumer = eventStore.consumer();
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: { lastCheckpoint: resumeCheckpoint },
            eachMessage: (event) => {
              fromResuming.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              fromEnd.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(fromResuming, stored.slice(initialEvents.length));
            assertDeepEqual(
              fromEnd,
              stored.slice(initialEvents.length + backlogEvents.length),
            );
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );

      void it(
        'multiple END reactors in one consumer each handle only new events',
        withDeadline,
        async () => {
          const guestId = uuid();
          const otherGuestId = uuid();
          const streamName = `guestStay-${guestId}`;

          const initialEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];
          await eventStore.appendToStream(streamName, initialEvents);

          const newEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];

          const firstEnd: GuestStayEvent[] = [];
          const secondEnd: GuestStayEvent[] = [];

          const consumer = eventStore.consumer();
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              firstEnd.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              secondEnd.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(firstEnd, stored.slice(initialEvents.length));
            assertDeepEqual(secondEnd, stored.slice(initialEvents.length));
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );
    });

    void it(
      'delivers all events appended after starting from END as the stream grows',
      withDeadline,
      async () => {
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const firstAppend: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
        ];
        const secondAppend: GuestStayEvent[] = [
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const fromEnd: GuestStayEvent[] = [];

        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            fromEnd.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, firstAppend);
          await eventStore.appendToStream(streamName, secondAppend);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(fromEnd, stored.slice(initialEvents.length));
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    (['BEGINNING', 'END'] as const).forEach((startFrom) => {
      void it(
        `does not persist a reactor checkpoint across a restart when checkpoints are DISABLED (startFrom ${startFrom})`,
        withDeadline,
        async () => {
          const guestId = uuid();
          const otherGuestId = uuid();
          const thirdGuestId = uuid();
          const streamName = `guestStay-${guestId}`;
          const processorId = uuid();

          const initialEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];
          await eventStore.appendToStream(streamName, initialEvents);

          const firstNewEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];
          const secondNewEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
          ];

          const firstRun: GuestStayEvent[] = [];
          const secondRun: GuestStayEvent[] = [];

          const firstConsumer = eventStore.consumer();
          firstConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
              firstRun.push(event);
            },
          });
          let firstConsumerPromise: Promise<void> | undefined;
          try {
            firstConsumerPromise = firstConsumer.start();
            await firstConsumer.whenStarted();
            await eventStore.appendToStream(streamName, firstNewEvents);
            await firstConsumer.whenCaughtUp();
          } finally {
            await firstConsumer.close();
            await firstConsumerPromise;
          }

          const secondConsumer = eventStore.consumer();
          secondConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
              secondRun.push(event);
            },
          });
          let secondConsumerPromise: Promise<void> | undefined;
          try {
            secondConsumerPromise = secondConsumer.start();
            await secondConsumer.whenStarted();
            await eventStore.appendToStream(streamName, secondNewEvents);
            await secondConsumer.whenCaughtUp();
          } finally {
            await secondConsumer.close();
            await secondConsumerPromise;
          }

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          const firstRunEnd = initialEvents.length + firstNewEvents.length;
          const expectedFirstRun =
            startFrom === 'BEGINNING'
              ? stored.slice(0, firstRunEnd)
              : stored.slice(initialEvents.length, firstRunEnd);
          const expectedSecondRun =
            startFrom === 'BEGINNING' ? stored : stored.slice(firstRunEnd);

          assertDeepEqual(firstRun, expectedFirstRun);
          assertDeepEqual(secondRun, expectedSecondRun);
        },
      );

      void it(
        `does not persist a projector checkpoint across a restart when checkpoints are DISABLED (startFrom ${startFrom})`,
        withDeadline,
        async () => {
          const guestId = uuid();
          const otherGuestId = uuid();
          const thirdGuestId = uuid();
          const streamName = `guestStay-${guestId}`;
          const processorId = uuid();
          const projectionName = `guestStays-${uuid()}`;

          const initialEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];
          await eventStore.appendToStream(streamName, initialEvents);

          const firstNewEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];
          const secondNewEvents: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
          ];

          const firstRun: GuestStayEvent[] = [];
          const secondRun: GuestStayEvent[] = [];

          const firstConsumer = eventStore.consumer();
          firstConsumer.projector<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            projection: collectingProjection(firstRun, projectionName),
          });
          let firstConsumerPromise: Promise<void> | undefined;
          try {
            firstConsumerPromise = firstConsumer.start();
            await firstConsumer.whenStarted();
            await eventStore.appendToStream(streamName, firstNewEvents);
            await firstConsumer.whenCaughtUp();
          } finally {
            await firstConsumer.close();
            await firstConsumerPromise;
          }

          const secondConsumer = eventStore.consumer();
          secondConsumer.projector<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            projection: collectingProjection(secondRun, projectionName),
          });
          let secondConsumerPromise: Promise<void> | undefined;
          try {
            secondConsumerPromise = secondConsumer.start();
            await secondConsumer.whenStarted();
            await eventStore.appendToStream(streamName, secondNewEvents);
            await secondConsumer.whenCaughtUp();
          } finally {
            await secondConsumer.close();
            await secondConsumerPromise;
          }

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          const firstRunEnd = initialEvents.length + firstNewEvents.length;
          const expectedFirstRun =
            startFrom === 'BEGINNING'
              ? stored.slice(0, firstRunEnd)
              : stored.slice(initialEvents.length, firstRunEnd);
          const expectedSecondRun =
            startFrom === 'BEGINNING' ? stored : stored.slice(firstRunEnd);

          assertDeepEqual(firstRun, expectedFirstRun);
          assertDeepEqual(secondRun, expectedSecondRun);
        },
      );
    });

    void it(
      'handles only new events when CURRENT position is stored for restarted consumer',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        await consumer.start();
        await consumer.stop();

        result = [];

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored.slice(initialEvents.length));
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when CURRENT position is stored for a new consumer',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        const { lastEventGlobalPosition: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: GuestStayEvent[] = [];

        const processorOptions: InMemoryReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        };

        // When
        const consumer = eventStore.consumer();
        try {
          consumer.reactor<GuestStayEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        result = [];

        const newConsumer = eventStore.consumer();
        newConsumer.reactor<GuestStayEvent>(processorOptions);

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await newConsumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored.slice(initialEvents.length));
        } finally {
          await newConsumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles only new events when startFrom END is specified',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored.slice(initialEvents.length));
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles events on empty store when startFrom END is specified',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'restarted END consumer resumes from last checkpoint',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const thirdGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const firstBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: GuestStayEvent[] = [];

        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(streamName, firstBatch);
        await consumer.whenCaughtUp();
        await consumer.stop();
        await firstConsumerPromise;

        // Run 2: restart and process second batch only
        result = [];

        const secondBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
        ];

        let secondConsumerPromise: Promise<void> | undefined;
        try {
          secondConsumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, secondBatch);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            result,
            stored.slice(initialEvents.length + firstBatch.length),
          );
        } finally {
          await consumer.close();
          await secondConsumerPromise;
        }
      },
    );

    void it(
      'restarted END consumer handles events appended while stopped',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const thirdGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const firstBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: GuestStayEvent[] = [];

        const consumer = eventStore.consumer();
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(streamName, firstBatch);
        await consumer.whenCaughtUp();
        const { events: storedAfterFirstRun } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        assertDeepEqual(
          result,
          storedAfterFirstRun.slice(initialEvents.length),
        );
        await consumer.stop();
        await firstConsumerPromise;

        // Run 2: process events appended while stopped
        result = [];

        const secondBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
        ];

        let secondConsumerPromise: Promise<void> | undefined;
        try {
          await eventStore.appendToStream(streamName, secondBatch);

          secondConsumerPromise = consumer.start();
          await consumer.whenStarted();

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            result,
            stored.slice(initialEvents.length + firstBatch.length),
          );
        } finally {
          await consumer.close();
          await secondConsumerPromise;
        }
      },
    );

    void it.each([{ version: 1 }, { version: 2 }])(
      'recreated END consumer handles events appended while stopped and after restart (version $version)',
      withDeadline,
      async ({ version }) => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const thirdGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const firstBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: GuestStayEvent[] = [];

        const reactorDefinition: InMemoryReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'END',
          version,
          eachMessage: (event) => {
            result.push(event);
          },
        };

        const firstConsumer = eventStore.consumer();
        firstConsumer.reactor<GuestStayEvent>(reactorDefinition);

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = firstConsumer.start();
        try {
          await firstConsumer.whenStarted();

          await eventStore.appendToStream(streamName, firstBatch);
          await firstConsumer.whenCaughtUp();
          const { events: storedAfterFirstRun } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            result,
            storedAfterFirstRun.slice(initialEvents.length),
          );
        } finally {
          await firstConsumer.close();
          await firstConsumerPromise;
        }

        // Run 2: process events appended while stopped
        const secondConsumer = eventStore.consumer();
        secondConsumer.reactor<GuestStayEvent>(reactorDefinition);
        result = [];

        const secondBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
        ];

        const liveGuestId = uuid();
        const liveBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: liveGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: liveGuestId } },
        ];

        let secondConsumerPromise: Promise<void> | undefined;
        try {
          await eventStore.appendToStream(streamName, secondBatch);

          secondConsumerPromise = secondConsumer.start();
          await secondConsumer.whenStarted();

          await eventStore.appendToStream(streamName, liveBatch);
          await secondConsumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            result,
            stored.slice(initialEvents.length + firstBatch.length),
          );
        } finally {
          await secondConsumer.close();
          await secondConsumerPromise;
        }
      },
    );

    void it(
      'new consumer with same processorId resumes despite startFrom BEGINNING after graceful stop',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [{ type: 'GuestCheckedIn', data: { guestId } }],
        );

        const consumer1 = eventStore.consumer();
        consumer1.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'BEGINNING',
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: () => {},
        });
        try {
          await consumer1.start();
        } finally {
          await consumer1.close();
        }

        const nextEvent: GuestStayEvent = {
          type: 'GuestCheckedOut',
          data: { guestId },
        };
        const { lastEventGlobalPosition: nextPosition } =
          await eventStore.appendToStream(streamName, [nextEvent]);
        const result: GuestStayEvent[] = [];

        const consumer2 = eventStore.consumer();
        consumer2.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'BEGINNING',
          stopAfter: (event) => event.metadata.globalPosition === nextPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer2.start();
          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(result, stored.slice(1));
        } finally {
          await consumer2.close();
        }
      },
    );
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
