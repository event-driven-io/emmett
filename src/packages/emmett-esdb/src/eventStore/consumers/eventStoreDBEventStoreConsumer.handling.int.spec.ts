import {
  assertThatArray,
  bigIntProcessorCheckpoint,
  delay,
  getInMemoryDatabase,
  type Event,
  type InMemoryReactorOptions,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import {
  $all,
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumerType,
} from './eventStoreDBEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('EventStoreDB event store started consumer', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let connectionString: string;
  let eventStore: EventStoreDBEventStore;
  const database = getInMemoryDatabase();

  beforeAll(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    connectionString = eventStoreDB.getConnectionString();
    eventStore = getEventStoreDBEventStore(eventStoreDB.getClient());
  });

  afterAll(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  const consumeFrom: [
    string,
    (streamName: string) => EventStoreDBEventStoreConsumerType,
  ][] = [
    ['all', () => ({ stream: $all })],
    ['stream', (streamName) => ({ stream: streamName })],
    [
      'category',
      () => ({ stream: '$ce-guestStay', options: { resolveLinkTos: true } }),
    ],
  ];

  void describe('eachMessage', () => {
    void it(
      `handles all events from $ce stream for subscription to stream`,
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${otherGuestId}`;
        const otherStreamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, events);
        const appendResult = await eventStore.appendToStream(
          otherStreamName,
          events,
        );

        const result: RecordedMessage<GuestStayEvent>[] = [];

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: '$ce-guestStay', options: { resolveLinkTos: true } },
        });

        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
          eachMessage: (event) => {
            if (
              event.metadata.streamName === streamName ||
              event.metadata.streamName === otherStreamName
            )
              result.push(event);
          },
        });

        try {
          await consumer.start();

          const expectedEvents: RecordedMessage<GuestStayEvent>[] = [
            ...events,
            ...events,
          ] as unknown as RecordedMessage<GuestStayEvent>[];

          assertThatArray(result).hasSize(expectedEvents.length);
          assertThatArray(result).containsElementsMatching(expectedEvents);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      `handles ONLY events from single streams for subscription to stream`,
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${otherGuestId}`;
        const otherStreamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        const appendResult = await eventStore.appendToStream(
          streamName,
          events,
        );
        await eventStore.appendToStream(otherStreamName, events);

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: streamName },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.checkpoint ===
            bigIntProcessorCheckpoint(appendResult.nextExpectedStreamVersion),
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer.start();

          assertThatArray(result).containsElementsMatching(events);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(`handles events SEQUENTIALLY`, { timeout: 15000 }, async () => {
      // Given
      const guestId = uuid();
      const otherGuestId = uuid();
      const streamName = `guestStay-${otherGuestId}`;
      const otherStreamName = `guestStay-${guestId}`;
      const events: NumberRecorded[] = [
        { type: 'NumberRecorded', data: { number: 1 } },
        { type: 'NumberRecorded', data: { number: 2 } },
        { type: 'NumberRecorded', data: { number: 3 } },
        { type: 'NumberRecorded', data: { number: 4 } },
        { type: 'NumberRecorded', data: { number: 5 } },
      ];
      const appendResult = await eventStore.appendToStream(streamName, events);
      await eventStore.appendToStream(otherStreamName, events);

      const result: NumberRecorded[] = [];

      // When
      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
        from: { stream: streamName },
      });
      consumer.reactor<NumberRecorded>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.checkpoint ===
          bigIntProcessorCheckpoint(appendResult.nextExpectedStreamVersion),
        eachMessage: async (event) => {
          await delay(Math.floor(Math.random() * 200));

          result.push(event);
        },
      });

      try {
        await consumer.start();

        assertThatArray(
          result.map((e) => e.data.number),
        ).containsElementsMatching(events.map((e) => e.data.number));
      } finally {
        await consumer.close();
      }
    });

    void it(
      `stops processing on unhandled error in handler`,
      { timeout: 1500000 },
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${otherGuestId}`;
        const otherStreamName = `guestStay-${guestId}`;
        const events: NumberRecorded[] = [
          { type: 'NumberRecorded', data: { number: 1 } },
          { type: 'NumberRecorded', data: { number: 2 } },
          { type: 'NumberRecorded', data: { number: 3 } },
          { type: 'NumberRecorded', data: { number: 4 } },
          { type: 'NumberRecorded', data: { number: 5 } },
          { type: 'NumberRecorded', data: { number: 6 } },
          { type: 'NumberRecorded', data: { number: 7 } },
          { type: 'NumberRecorded', data: { number: 8 } },
          { type: 'NumberRecorded', data: { number: 9 } },
          { type: 'NumberRecorded', data: { number: 10 } },
        ];
        const appendResult = await eventStore.appendToStream(
          streamName,
          events,
        );
        await eventStore.appendToStream(otherStreamName, events);

        const result: NumberRecorded[] = [];

        let shouldThrowRandomError = false;

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: streamName },
        });
        consumer.reactor<NumberRecorded>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.checkpoint ===
            bigIntProcessorCheckpoint(appendResult.nextExpectedStreamVersion),
          eachMessage: (event) => {
            if (shouldThrowRandomError) {
              return Promise.reject(new Error('Random error'));
            }

            result.push(event);

            shouldThrowRandomError = !shouldThrowRandomError;
            return Promise.resolve();
          },
        });

        try {
          await consumer.start();

          assertThatArray(result.map((e) => e.data.number)).containsExactly(1);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      `handles all events from $all streams for subscription to stream`,
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${otherGuestId}`;
        const otherStreamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, events);
        const appendResult = await eventStore.appendToStream(
          otherStreamName,
          events,
        );

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: $all },
        });

        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.globalPosition ===
            appendResult.lastEventGlobalPosition,
          eachMessage: (event) => {
            if (
              event.metadata.streamName === streamName ||
              event.metadata.streamName === otherStreamName
            )
              result.push(event);
          },
        });

        try {
          await consumer.start();

          assertThatArray(result).hasSize(events.length * 2);

          assertThatArray(result).containsElementsMatching([
            ...events,
            ...events,
          ]);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      `handles ONLY events from stream AFTER provided global position`,
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
        const { nextExpectedStreamVersion: startPosition } =
          await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const result: GuestStayEvent[] = [];

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: streamName },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: {
            lastCheckpoint: bigIntProcessorCheckpoint(startPosition),
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

          assertThatArray(result).containsOnlyElementsMatching(events);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      `handles ONLY events from $all AFTER provided global position`,
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
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: $all },
        });
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

          assertThatArray(result).containsOnlyElementsMatching(events);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    const projectionStreams: [
      string,
      EventStoreDBEventStoreConsumerType,
      (events: GuestStayEvent[]) => GuestStayEvent[],
    ][] = [
      [
        'category projection',
        { stream: '$ce-guestStay', options: { resolveLinkTos: true } },
        (events: GuestStayEvent[]) => events,
      ],
      [
        'event type projection',
        { stream: '$et-GuestCheckedOut', options: { resolveLinkTos: true } },
        (events: GuestStayEvent[]) =>
          events.filter((event) => event.type === 'GuestCheckedOut'),
      ],
    ];

    projectionStreams.forEach(([displayName, from, expectedEvents]) => {
      void it(
        `handles only new events when starting from END for ${displayName}`,
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
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from,
          });
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

            assertThatArray(result).containsOnlyElementsMatching(
              expectedEvents(events),
            );
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );
    });

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
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: { stream: $all },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'BEGINNING',
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName)
                fromBeginning.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName) fromEnd.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

            assertThatArray(fromBeginning).containsElementsMatching([
              ...initialEvents,
              ...newEvents,
            ]);
            assertThatArray(fromEnd).containsOnlyElementsMatching(newEvents);
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );
    });

    consumeFrom.forEach(([displayName, from]) => {
      void it(
        `handles all events from ${displayName} appended to event store BEFORE processor was started`,
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
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
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

            assertThatArray(result).containsElementsMatching(events);
          } finally {
            await consumer.close();
          }
        },
      );

      void it(
        `handles all events from ${displayName} appended to event store AFTER processor was started`,
        withDeadline,
        async () => {
          // Given

          const result: GuestStayEvent[] = [];

          const guestId = uuid();
          const streamName = `guestStay-${guestId}`;

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            eachMessage: (event) => {
              result.push(event);
            },
          });

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

            assertThatArray(result).containsElementsMatching(events);
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );

      void it(
        `handles all events from ${displayName} when CURRENT position is NOT stored`,
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
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
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

            assertThatArray(result).containsElementsMatching([
              ...initialEvents,
              ...events,
            ]);
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );

      void it(
        `handles only new events when CURRENT position is stored for restarted consumer from ${displayName}`,
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

          let result: GuestStayEvent[] = [];

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'CURRENT',
            eachMessage: (event) => {
              result.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined = consumer.start();
          await consumer.whenStarted();
          await consumer.whenCaughtUp();
          await consumer.stop();
          await consumerPromise;

          result = [];

          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, events);

            await consumer.whenCaughtUp();

            assertThatArray(result).containsOnlyElementsMatching(events);
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );

      void it(
        `handles only new events when CURRENT position is stored for a new consumer from ${displayName}`,
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

          let result: GuestStayEvent[] = [];

          const processorOptions: InMemoryReactorOptions<GuestStayEvent> = {
            processorId: uuid(),
            startFrom: 'CURRENT',
            eachMessage: (event) => {
              result.push(event);
            },
            connectionOptions: { database },
          };

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          let consumerPromise: Promise<void> | undefined;
          try {
            consumer.reactor<GuestStayEvent>(processorOptions);

            consumerPromise = consumer.start();
            await consumer.whenStarted();
            await consumer.whenCaughtUp();
          } finally {
            await consumer.close();
            await consumerPromise;
          }

          result = [];

          const newConsumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          newConsumer.reactor<GuestStayEvent>(processorOptions);

          let newConsumerPromise: Promise<void> | undefined;
          try {
            newConsumerPromise = newConsumer.start();
            await newConsumer.whenStarted();

            await eventStore.appendToStream(streamName, events);

            await newConsumer.whenCaughtUp();

            assertThatArray(result).containsOnlyElementsMatching(events);
          } finally {
            await newConsumer.close();
            await newConsumerPromise;
          }
        },
      );
    });
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type NumberRecorded = Event<'NumberRecorded', { number: number }>;
