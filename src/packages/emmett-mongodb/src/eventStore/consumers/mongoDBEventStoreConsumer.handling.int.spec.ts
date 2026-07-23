import {
  assertThatArray,
  asyncAwaiter,
  delay,
  inMemoryReactor,
  type Closeable,
  type Event,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { compareTwoMongoDBCheckpoints } from './subscriptions';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('MongoDB event store started consumer', () => {
  let mongoDB: StartedMongoDBContainer;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  //const database = getInMemoryDatabase();

  beforeAll(async () => {
    mongoDB = await getMongoDBStartedContainer();
    connectionString = mongoDB.getConnectionString();
    eventStore = getMongoDBEventStore({
      connectionString: mongoDB.getConnectionString(),
      clientOptions: { directConnection: true },
    });
  });

  afterAll(async () => {
    try {
      await eventStore.close();
      await mongoDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('eachMessage', () => {
    void it(`handles events SEQUENTIALLY`, { timeout: 30000 }, async () => {
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
      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        processors: [
          inMemoryReactor<NumberRecorded>({
            processorId: uuid(),
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition ===
                appendResult.nextExpectedStreamVersion,
            eachMessage: async (event) => {
              await delay(Math.floor(Math.random() * 200));

              result.push(event);
            },
          }),
        ],
        clientOptions: { directConnection: true },
      });

      try {
        await consumer.start();

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
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          processors: [
            inMemoryReactor<NumberRecorded>({
              processorId: uuid(),
              stopAfter: (event) =>
                event.metadata.streamName === streamName &&
                event.metadata.streamPosition ===
                  appendResult.nextExpectedStreamVersion,
              eachMessage: (event) => {
                if (shouldThrowRandomError) {
                  return Promise.reject(new Error('Random error'));
                }

                result.push(event);

                shouldThrowRandomError = !shouldThrowRandomError;
                return Promise.resolve();
              },
            }),
          ],
          clientOptions: { directConnection: true },
        });

        try {
          await consumer.start();

          assertThatArray(result.map((e) => e.data.number)).containsExactly(1);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(`handles all events`, withDeadline, async () => {
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
      const consumer = mongoDBEventStoreConsumer({
        connectionString,
        processors: [
          inMemoryReactor<GuestStayEvent>({
            processorId: uuid(),
            stopAfter: (event) =>
              event.metadata.streamName === otherStreamName &&
              event.metadata.streamPosition ===
                appendResult.nextExpectedStreamVersion,
            eachMessage: (event) => {
              if (
                event.metadata.streamName === streamName ||
                event.metadata.streamName === otherStreamName
              )
                result.push(event);
            },
          }),
        ],
        clientOptions: { directConnection: true },
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
    });

    void it(
      `resolves whenProcessed and whenCaughtUp for events appended after start`,
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
        let lastCheckpoint: ProcessorCheckpoint | undefined;
        const reachedEnd = asyncAwaiter();

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              compareCheckpoints: compareTwoMongoDBCheckpoints as (
                a: ProcessorCheckpoint,
                b: ProcessorCheckpoint,
              ) => number,
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                result.push(event);
                lastCheckpoint = event.metadata
                  .checkpoint as ProcessorCheckpoint;
                if (event.type === 'GuestCheckedOut') reachedEnd.resolve();
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await reachedEnd.wait;
          await consumer.whenProcessed(lastCheckpoint!);
          await consumer.whenCaughtUp();

          assertThatArray(result).containsElementsMatching(events);
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type NumberRecorded = Event<'NumberRecorded', { number: number }>;
