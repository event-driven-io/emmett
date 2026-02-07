import {
  assertThatArray,
  delay,
  inMemoryReactor,
  type Closeable,
  type Event,
} from '@event-driven-io/emmett';
import type { StartedMongoDBContainer } from '@testcontainers/mongodb';
import { after, before, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import { getMongoDBStartedContainer } from '@event-driven-io/emmett-testcontainers';

const withDeadline = { timeout: 30000 };

void describe('MongoDB event store started consumer', () => {
  let mongoDB: StartedMongoDBContainer;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  //const database = getInMemoryDatabase();

  before(async () => {
    mongoDB = await getMongoDBStartedContainer();
    connectionString = mongoDB.getConnectionString();
    eventStore = getMongoDBEventStore({
      connectionString: mongoDB.getConnectionString(),
      clientOptions: { directConnection: true },
    });
  });

  after(async () => {
    try {
      await eventStore.close();
      await mongoDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('eachMessage', () => {
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

    // void it(
    //   `handles ONLY events from stream AFTER provided global position`,
    //   withDeadline,
    //   async () => {
    //     // Given
    //     const guestId = uuid();
    //     const otherGuestId = uuid();
    //     const streamName = `guestStay-${guestId}`;

    //     const initialEvents: GuestStayEvent[] = [
    //       { type: 'GuestCheckedIn', data: { guestId } },
    //       { type: 'GuestCheckedOut', data: { guestId } },
    //     ];
    //     const { nextExpectedStreamVersion: startPosition } =
    //       await eventStore.appendToStream(streamName, initialEvents);

    //     const events: GuestStayEvent[] = [
    //       { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
    //       { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
    //     ];

    //     const result: GuestStayEvent[] = [];
    //     let stopAfterPosition: bigint | undefined = undefined;

    //     // When
    //     const consumer = mongoDBEventStoreConsumer({
    //       connectionString,
    //       from: { stream: streamName },
    //     });
    //     consumer.reactor<GuestStayEvent>({
    //       processorId: uuid(),
    //       startFrom: { lastCheckpoint: startPosition },
    //       stopAfter: (event) =>
    //         event.metadata.streamPosition === stopAfterPosition,
    //       eachMessage: (event) => {
    //         result.push(event);
    //       },
    //     });

    //     try {
    //       const consumerPromise = consumer.start();

    //       const appendResult = await eventStore.appendToStream(
    //         streamName,
    //         events,
    //       );
    //       stopAfterPosition = appendResult.nextExpectedStreamVersion;

    //       await consumerPromise;

    //       assertThatArray(result).containsOnlyElementsMatching(events);
    //     } finally {
    //       await consumer.close();
    //     }
    //   },
    // );

    // void it(
    //   `handles ONLY events from $all AFTER provided global position`,
    //   withDeadline,
    //   async () => {
    //     // Given
    //     const guestId = uuid();
    //     const otherGuestId = uuid();
    //     const streamName = `guestStay-${guestId}`;

    //     const initialEvents: GuestStayEvent[] = [
    //       { type: 'GuestCheckedIn', data: { guestId } },
    //       { type: 'GuestCheckedOut', data: { guestId } },
    //     ];
    //     const { lastEventGlobalPosition: startPosition } =
    //       await eventStore.appendToStream(streamName, initialEvents);

    //     const events: GuestStayEvent[] = [
    //       { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
    //       { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
    //     ];

    //     const result: GuestStayEvent[] = [];
    //     let stopAfterPosition: bigint | undefined = undefined;

    //     // When
    //     const consumer = mongoDBEventStoreConsumer({
    //       connectionString,
    //       from: { stream: $all },
    //     });
    //     consumer.reactor<GuestStayEvent>({
    //       processorId: uuid(),
    //       startFrom: { lastCheckpoint: startPosition },
    //       stopAfter: (event) =>
    //         event.metadata.globalPosition === stopAfterPosition,
    //       eachMessage: (event) => {
    //         result.push(event);
    //       },
    //     });

    //     try {
    //       const consumerPromise = consumer.start();

    //       const appendResult = await eventStore.appendToStream(
    //         streamName,
    //         events,
    //       );
    //       stopAfterPosition = appendResult.lastEventGlobalPosition;

    //       await consumerPromise;

    //       assertThatArray(result).containsOnlyElementsMatching(events);
    //     } finally {
    //       await consumer.close();
    //     }
    //   },
    // );

    // consumeFrom.forEach(([displayName, from]) => {
    //   void it(
    //     `handles all events from ${displayName} appended to event store BEFORE processor was started`,
    //     withDeadline,
    //     async () => {
    //       // Given
    //       const guestId = uuid();
    //       const streamName = `guestStay-${guestId}`;
    //       const events: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId } },
    //         { type: 'GuestCheckedOut', data: { guestId } },
    //       ];
    //       const appendResult = await eventStore.appendToStream(
    //         streamName,
    //         events,
    //       );

    //       const result: GuestStayEvent[] = [];

    //       // When
    //       const consumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       consumer.reactor<GuestStayEvent>({
    //         processorId: uuid(),
    //         stopAfter: (event) =>
    //           event.metadata.globalPosition ===
    //           appendResult.lastEventGlobalPosition,
    //         eachMessage: (event) => {
    //           result.push(event);
    //         },
    //       });

    //       try {
    //         await consumer.start();

    //         assertThatArray(result).containsElementsMatching(events);
    //       } finally {
    //         await consumer.close();
    //       }
    //     },
    //   );

    //   void it(
    //     `handles all events from ${displayName} appended to event store AFTER processor was started`,
    //     withDeadline,
    //     async () => {
    //       // Given

    //       const result: GuestStayEvent[] = [];
    //       let stopAfterPosition: bigint | undefined = undefined;

    //       const guestId = uuid();
    //       const streamName = `guestStay-${guestId}`;
    //       const waitForStart = asyncAwaiter();

    //       // When
    //       const consumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       consumer.reactor<GuestStayEvent>({
    //         processorId: uuid(),
    //         stopAfter: (event) =>
    //           event.metadata.globalPosition === stopAfterPosition,
    //         eachMessage: async (event) => {
    //           await waitForStart.wait;
    //           result.push(event);
    //         },
    //       });

    //       const events: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId } },
    //         { type: 'GuestCheckedOut', data: { guestId } },
    //       ];

    //       try {
    //         const consumerPromise = consumer.start();

    //         const appendResult = await eventStore.appendToStream(
    //           streamName,
    //           events,
    //         );
    //         stopAfterPosition = appendResult.lastEventGlobalPosition;
    //         waitForStart.resolve();

    //         await consumerPromise;

    //         assertThatArray(result).containsElementsMatching(events);
    //       } finally {
    //         await consumer.close();
    //       }
    //     },
    //   );

    //   void it(
    //     `handles all events from ${displayName} when CURRENT position is NOT stored`,
    //     withDeadline,
    //     async () => {
    //       // Given
    //       const guestId = uuid();
    //       const otherGuestId = uuid();
    //       const streamName = `guestStay-${guestId}`;

    //       const initialEvents: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId } },
    //         { type: 'GuestCheckedOut', data: { guestId } },
    //       ];

    //       await eventStore.appendToStream(streamName, initialEvents);

    //       const events: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
    //         { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
    //       ];

    //       const result: GuestStayEvent[] = [];
    //       let stopAfterPosition: bigint | undefined = undefined;
    //       const waitForStart = asyncAwaiter();

    //       // When
    //       const consumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       consumer.reactor<GuestStayEvent>({
    //         processorId: uuid(),
    //         startFrom: 'CURRENT',
    //         stopAfter: (event) =>
    //           event.metadata.globalPosition === stopAfterPosition,
    //         eachMessage: async (event) => {
    //           await waitForStart.wait;
    //           result.push(event);
    //         },
    //       });

    //       try {
    //         const consumerPromise = consumer.start();

    //         const appendResult = await eventStore.appendToStream(
    //           streamName,
    //           events,
    //         );
    //         stopAfterPosition = appendResult.lastEventGlobalPosition;
    //         waitForStart.resolve();

    //         await consumerPromise;

    //         assertThatArray(result).containsElementsMatching([
    //           ...initialEvents,
    //           ...events,
    //         ]);
    //       } finally {
    //         await consumer.close();
    //       }
    //     },
    //   );

    //   void it(
    //     `handles only new events when CURRENT position is stored for restarted consumer from ${displayName}`,
    //     withDeadline,
    //     async () => {
    //       // Given
    //       const guestId = uuid();
    //       const otherGuestId = uuid();
    //       const streamName = `guestStay-${guestId}`;

    //       const initialEvents: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId } },
    //         { type: 'GuestCheckedOut', data: { guestId } },
    //       ];
    //       const { lastEventGlobalPosition } = await eventStore.appendToStream(
    //         streamName,
    //         initialEvents,
    //       );

    //       const events: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
    //         { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
    //       ];

    //       let result: GuestStayEvent[] = [];
    //       let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

    //       const waitForStart = asyncAwaiter();

    //       // When
    //       const consumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       consumer.reactor<GuestStayEvent>({
    //         processorId: uuid(),
    //         startFrom: 'CURRENT',
    //         stopAfter: (event) =>
    //           event.metadata.globalPosition === stopAfterPosition,
    //         eachMessage: async (event) => {
    //           await waitForStart.wait;
    //           result.push(event);
    //         },
    //       });

    //       let consumerPromise = consumer.start();
    //       waitForStart.resolve();
    //       await consumerPromise;
    //       await consumer.stop();

    //       waitForStart.reset();

    //       result = [];

    //       stopAfterPosition = undefined;

    //       try {
    //         consumerPromise = consumer.start();

    //         const appendResult = await eventStore.appendToStream(
    //           streamName,
    //           events,
    //         );
    //         stopAfterPosition = appendResult.lastEventGlobalPosition;
    //         waitForStart.resolve();

    //         await consumerPromise;

    //         assertThatArray(result).containsOnlyElementsMatching(events);
    //       } finally {
    //         await consumer.close();
    //       }
    //     },
    //   );

    //   void it(
    //     `handles only new events when CURRENT position is stored for a new consumer from ${displayName}`,
    //     withDeadline,
    //     async () => {
    //       // Given
    //       const guestId = uuid();
    //       const otherGuestId = uuid();
    //       const streamName = `guestStay-${guestId}`;

    //       const initialEvents: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId } },
    //         { type: 'GuestCheckedOut', data: { guestId } },
    //       ];
    //       const { lastEventGlobalPosition } = await eventStore.appendToStream(
    //         streamName,
    //         initialEvents,
    //       );

    //       const events: GuestStayEvent[] = [
    //         { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
    //         { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
    //       ];

    //       let result: GuestStayEvent[] = [];
    //       let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

    //       const waitForStart = asyncAwaiter();
    //       const processorOptions: InMemoryReactorOptions<GuestStayEvent> = {
    //         processorId: uuid(),
    //         startFrom: 'CURRENT',
    //         stopAfter: (event) =>
    //           event.metadata.globalPosition === stopAfterPosition,
    //         eachMessage: async (event) => {
    //           await waitForStart.wait;
    //           result.push(event);
    //         },
    //         connectionOptions: { database },
    //       };

    //       // When
    //       const consumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       try {
    //         consumer.reactor<GuestStayEvent>(processorOptions);

    //         waitForStart.resolve();
    //         await consumer.start();
    //       } finally {
    //         await consumer.close();
    //       }

    //       result = [];

    //       waitForStart.reset();
    //       stopAfterPosition = undefined;

    //       const newConsumer = mongoDBEventStoreConsumer({
    //         connectionString,
    //         from: from(streamName),
    //       });
    //       newConsumer.reactor<GuestStayEvent>(processorOptions);

    //       try {
    //         const consumerPromise = newConsumer.start();

    //         const appendResult = await eventStore.appendToStream(
    //           streamName,
    //           events,
    //         );
    //         waitForStart.resolve();
    //         stopAfterPosition = appendResult.lastEventGlobalPosition;

    //         await consumerPromise;

    //         assertThatArray(result).containsOnlyElementsMatching(events);
    //       } finally {
    //         await newConsumer.close();
    //       }
    //     },
    //   );
    // });
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type NumberRecorded = Event<'NumberRecorded', { number: number }>;
