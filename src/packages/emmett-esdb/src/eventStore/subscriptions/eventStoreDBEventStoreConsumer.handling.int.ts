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
import { eventStoreDBEventStoreConsumer } from './eventStoreDBEventStoreConsumer';
import type { EventStoreDBEventStoreSubscriptionOptions } from './eventStoreDBEventStoreSubscription';

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

  void describe('eachMessage', () => {
    void it('handles all events appended to event store BEFORE subscription was started', async () => {
      // Given
      const guestId = uuid();
      const streamName = `guestStay-${guestId}`;
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];
      const appendResult = await eventStore.appendToStream(streamName, events);

      const result: GuestStayEvent[] = [];

      // When
      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });
      consumer.subscribe<GuestStayEvent>({
        subscriptionId: uuid(),
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
    });

    void it('handles all events appended to event store AFTER subscription was started', async () => {
      // Given

      const result: GuestStayEvent[] = [];
      let stopAfterPosition: bigint | undefined = undefined;

      // When
      const consumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });
      consumer.subscribe<GuestStayEvent>({
        subscriptionId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition === stopAfterPosition,
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
    });

    void it('handles ONLY events AFTER provided global position', async () => {
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
      });
      consumer.subscribe<GuestStayEvent>({
        subscriptionId: uuid(),
        startFrom: { globalPosition: startPosition },
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
    });

    void it('handles all events when CURRENT position is NOT stored', async () => {
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
      });
      consumer.subscribe<GuestStayEvent>({
        subscriptionId: uuid(),
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
    });

    void it('handles only new events when CURRENT position is stored for restarted consumer', async () => {
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
      });
      consumer.subscribe<GuestStayEvent>({
        subscriptionId: uuid(),
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
    });

    void it('handles only new events when CURRENT position is stored for a new consumer', async () => {
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

      const subscriptionOptions: EventStoreDBEventStoreSubscriptionOptions<GuestStayEvent> =
        {
          subscriptionId: uuid(),
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
      });
      try {
        consumer.subscribe<GuestStayEvent>(subscriptionOptions);

        await consumer.start();
      } finally {
        await consumer.close();
      }

      result = [];

      stopAfterPosition = undefined;

      const newConsumer = eventStoreDBEventStoreConsumer({
        connectionString,
      });
      newConsumer.subscribe<GuestStayEvent>(subscriptionOptions);

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
    });
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
