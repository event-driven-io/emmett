import { assertThatArray, type Event } from '@event-driven-io/emmett';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  type EventStoreDBEventStore,
  getEventStoreDBEventStore,
} from '../eventstoreDBEventStore';
import {
  $all,
  eventStoreDBEventStoreConsumer,
  type EventStoreDBEventStoreConsumerType,
} from './eventStoreDBEventStoreConsumer';
import type { EventStoreDBEventStoreProcessorOptions } from './eventStoreDBEventStoreProcessor';

const withDeadline = { timeout: 5000 };

void describe('EventStoreDB event store started consumer', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let connectionString: string;
  let eventStore: EventStoreDBEventStore;

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
  ];

  void describe('eachMessage', () => {
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
        consumer.processor<GuestStayEvent>({
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

        consumer.processor<GuestStayEvent>({
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
        consumer.processor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: { position: startPosition },
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
        consumer.processor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: { position: startPosition },
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
          consumer.processor<GuestStayEvent>({
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
          consumer.processor<GuestStayEvent>({
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
          consumer.processor<GuestStayEvent>({
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
          consumer.processor<GuestStayEvent>({
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

      void it.skip(
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

          const processorOptions: EventStoreDBEventStoreProcessorOptions<GuestStayEvent> =
            {
              processorId: uuid(),
              startFrom: 'CURRENT',
              stopAfter: (event) =>
                event.metadata.globalPosition === stopAfterPosition,
              eachMessage: (event) => {
                result.push(event);
              },
            };

          // When
          const consumer = eventStoreDBEventStoreConsumer({
            connectionString,
            from: from(streamName),
          });
          try {
            consumer.processor<GuestStayEvent>(processorOptions);

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
          newConsumer.processor<GuestStayEvent>(processorOptions);

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
