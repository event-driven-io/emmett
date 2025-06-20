import {
  assertThatArray,
  delay,
  getInMemoryDatabase,
  type Event,
  type InMemoryReactorOptions,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import {
  $all,
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumerType,
} from './eventStoreDBEventStoreConsumer';

const withDeadline = { timeout: 10000 };

void describe('EventStoreDB event store started consumer', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let connectionString: string;
  let eventStore: EventStoreDBEventStore;
  const database = getInMemoryDatabase();

  before(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    connectionString = eventStoreDB.getConnectionString();
    eventStore = getEventStoreDBEventStore(eventStoreDB.getClient());
  });

  after(async () => {
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
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: async (event) => {
          await delay(Math.floor(Math.random() * 150));

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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: streamName },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: { lastCheckpoint: startPosition },
          stopAfter: (event) =>
            event.metadata.streamPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.nextExpectedStreamVersion;

          await consumerPromise;

          assertThatArray(result).containsOnlyElementsMatching(events);
        } finally {
          await consumer.close();
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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = eventStoreDBEventStoreConsumer({
          connectionString,
          from: { stream: $all },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: { lastCheckpoint: startPosition },
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          assertThatArray(result).containsOnlyElementsMatching(events);
        } finally {
          await consumer.close();
        }
      },
    );

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
          let stopAfterPosition: bigint | undefined = undefined;

          const guestId = uuid();
          const streamName = `guestStay-${guestId}`;

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              result.push(event);
            },
          });

          const events: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedOut', data: { guestId } },
          ];

          try {
            const consumerPromise = consumer.start();

            const appendResult = await eventStore.appendToStream(
              streamName,
              events,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(result).containsElementsMatching(events);
          } finally {
            await consumer.close();
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
          let stopAfterPosition: bigint | undefined = undefined;

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              result.push(event);
            },
          });

          try {
            const consumerPromise = consumer.start();

            const appendResult = await eventStore.appendToStream(
              streamName,
              events,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(result).containsElementsMatching([
              ...initialEvents,
              ...events,
            ]);
          } finally {
            await consumer.close();
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
          const { lastEventGlobalPosition } = await eventStore.appendToStream(
            streamName,
            initialEvents,
          );

          const events: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];

          let result: GuestStayEvent[] = [];
          let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              result.push(event);
            },
          });

          await consumer.start();
          await consumer.stop();

          result = [];

          stopAfterPosition = undefined;

          try {
            const consumerPromise = consumer.start();

            const appendResult = await eventStore.appendToStream(
              streamName,
              events,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(result).containsOnlyElementsMatching(events);
          } finally {
            await consumer.close();
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
          const { lastEventGlobalPosition } = await eventStore.appendToStream(
            streamName,
            initialEvents,
          );

          const events: GuestStayEvent[] = [
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
            { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
          ];

          let result: GuestStayEvent[] = [];
          let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

          const processorOptions: InMemoryReactorOptions<GuestStayEvent> = {
            processorId: uuid(),
            startFrom: 'CURRENT',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
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
          try {
            consumer.reactor<GuestStayEvent>(processorOptions);

            await consumer.start();
          } finally {
            await consumer.close();
          }

          result = [];

          stopAfterPosition = undefined;

          const newConsumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          newConsumer.reactor<GuestStayEvent>(processorOptions);

          try {
            const consumerPromise = newConsumer.start();

            const appendResult = await eventStore.appendToStream(
              streamName,
              events,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(result).containsOnlyElementsMatching(events);
          } finally {
            await newConsumer.close();
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
