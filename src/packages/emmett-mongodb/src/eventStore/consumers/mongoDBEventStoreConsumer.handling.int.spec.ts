import { ObservabilitySpec } from '@event-driven-io/almanac';
import {
  assertDeepEqual,
  assertEqual,
  assertOk,
  delay,
  EmmettAttributes,
  EmmettSpans,
  inMemoryReactor,
  type Closeable,
  type Event,
  type ProcessorCheckpoint,
  type ReadEvent,
  type RecordedMessage,
  type RecordedMessageMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import {
  mongoDBEventStoreConsumer,
  type MongoDBChangeStreamMessageMetadata,
} from './mongoDBEventStoreConsumer';
import type {
  MongoDBProcessorOptions,
  MongoDBProjectorOptions,
} from './mongoDBProcessor';

const withDeadline = { timeout: 30000 };

const withoutSubscriptionCheckpoint = (events: Event[]) =>
  events.map((event) => {
    const {
      metadata: {
        checkpoint: _checkpoint,
        globalPosition: _globalPosition,
        ...metadata
      },
      ...rest
    } = event as RecordedMessage<
      Event,
      RecordedMessageMetadataWithGlobalPosition
    >;
    return { ...rest, metadata };
  });

void describe('MongoDB event store started consumer', () => {
  let database: SharedMongoDBDatabase;
  let connectionString: string;
  let eventStore: MongoDBEventStore & Closeable;
  //const database = getInMemoryDatabase();

  beforeAll(() => {
    database = sharedMongoDBDatabase();
    connectionString = database.connectionString;
    eventStore = getMongoDBEventStore({
      connectionString,
      clientOptions: { directConnection: true },
    });
  });

  afterAll(async () => {
    try {
      await eventStore.close();
      await database.close();
    } catch (error) {
      console.log(error);
    }
  });

  const collectingProjection = (
    collected: ReadEvent<GuestStayEvent, MongoDBChangeStreamMessageMetadata>[],
    streamName: string,
    projectionName: string,
  ): MongoDBProjectorOptions<GuestStayEvent>['projection'] => ({
    name: projectionName,
    canHandle: ['GuestCheckedIn', 'GuestCheckedOut'],
    handle: (events) => {
      collected.push(
        ...events.filter((event) => event.metadata.streamName === streamName),
      );
    },
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

      const result: ReadEvent<
        NumberRecorded,
        MongoDBChangeStreamMessageMetadata
      >[] = [];

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

        const { events: stored } =
          await eventStore.readStream<NumberRecorded>(streamName);
        const received = result.filter(
          (event) => event.metadata.streamName === streamName,
        );
        assertDeepEqual(
          withoutSubscriptionCheckpoint(received),
          withoutSubscriptionCheckpoint(stored),
        );
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

        const result: ReadEvent<
          NumberRecorded,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

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
                if (event.metadata.streamName !== streamName)
                  return Promise.resolve();

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

          const { events: stored } =
            await eventStore.readStream<NumberRecorded>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored.slice(0, 1)),
          );
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

      const result: ReadEvent<
        GuestStayEvent,
        MongoDBChangeStreamMessageMetadata
      >[] = [];

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

        const { events: stored } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        const { events: otherStored } =
          await eventStore.readStream<GuestStayEvent>(otherStreamName);
        assertDeepEqual(
          withoutSubscriptionCheckpoint(result),
          withoutSubscriptionCheckpoint([...stored, ...otherStored]),
        );
      } finally {
        await consumer.close();
      }
    });

    void it(
      `catches up with events appended after start`,
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                result.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored),
          );
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'handles ONLY events AFTER provided checkpoint',
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

        // First, capture the checkpoint of the last initial event
        let startCheckpoint: ProcessorCheckpoint | undefined;
        const captureConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              stopAfter: (event) =>
                event.metadata.streamName === streamName &&
                event.metadata.streamPosition === 2n,
              eachMessage: (event) => {
                if (
                  event.metadata.streamName === streamName &&
                  event.metadata.streamPosition === 2n
                )
                  startCheckpoint = event.metadata
                    .checkpoint as ProcessorCheckpoint;
              },
            }),
          ],
        });
        try {
          await captureConsumer.start();
        } finally {
          await captureConsumer.close();
        }

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: { lastCheckpoint: startCheckpoint! },
              eachMessage: (event) => {
                if (event.metadata.streamName !== streamName) return;
                result.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored.slice(initialEvents.length)),
          );
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

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'CURRENT',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  result.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored),
          );
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
        const processorId = uuid();

        const initialEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ];
        await eventStore.appendToStream(streamName, initialEvents);

        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        let result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When - first consumer catches up with CURRENT and persists checkpoint
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
        consumer.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'CURRENT',
          connectionOptions: {
            connectionString,
            clientOptions: { directConnection: true },
          },
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === 2n,
          eachMessage: (event) => {
            if (event.metadata.streamName === streamName) result.push(event);
          },
        });
        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        result = [];

        const newConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
        newConsumer.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'CURRENT',
          connectionOptions: {
            connectionString,
            clientOptions: { directConnection: true },
          },
          eachMessage: (event) => {
            if (event.metadata.streamName === streamName) result.push(event);
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();
          await newConsumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await newConsumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored.slice(initialEvents.length)),
          );
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

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'END',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  result.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored.slice(initialEvents.length)),
          );
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

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'END',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  result.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(stored),
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

        await eventStore.appendToStream(streamName, [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ]);

        const newEvents: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const firstEnd: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];
        const secondEnd: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'END',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  firstEnd.push(event);
              },
            }),
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'END',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  secondEnd.push(event);
              },
            }),
          ],
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, newEvents);

          await consumer.whenCaughtUp();

          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(firstEnd),
            withoutSubscriptionCheckpoint(stored.slice(-newEvents.length)),
          );
          assertDeepEqual(
            withoutSubscriptionCheckpoint(secondEnd),
            withoutSubscriptionCheckpoint(stored.slice(-newEvents.length)),
          );
        } finally {
          await consumer.close();
          await consumerPromise;
        }
      },
    );

    void it(
      'delivers all events appended after starting from END as the stream grows',
      withDeadline,
      async () => {
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;

        await eventStore.appendToStream(streamName, [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
        ]);

        const firstAppend: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
        ];
        const secondAppend: GuestStayEvent[] = [
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];

        const fromEnd: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'END',
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  fromEnd.push(event);
              },
            }),
          ],
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
          assertDeepEqual(
            withoutSubscriptionCheckpoint(fromEnd),
            withoutSubscriptionCheckpoint(
              stored.slice(-(firstAppend.length + secondAppend.length)),
            ),
          );
        } finally {
          await consumer.close();
          await consumerPromise;
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

        let result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          connectionOptions: {
            connectionString,
            clientOptions: { directConnection: true },
          },
          eachMessage: (event) => {
            if (event.metadata.streamName === streamName) result.push(event);
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(streamName, firstBatch);
        await consumer.whenCaughtUp();
        const { events: firstRunStored } =
          await eventStore.readStream<GuestStayEvent>(streamName);
        assertDeepEqual(
          withoutSubscriptionCheckpoint(result),
          withoutSubscriptionCheckpoint(
            firstRunStored.slice(initialEvents.length),
          ),
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
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(
              stored.slice(initialEvents.length + firstBatch.length),
            ),
          );
        } finally {
          await consumer.close();
          await secondConsumerPromise;
        }
      },
    );

    void it.each([
      { version: 1, lock: 'default' },
      { version: 2, lock: 'default' },
      { version: 1, lock: 'custom' },
    ])(
      'recreated END consumer handles events appended while stopped and after restart (version $version, $lock lock)',
      withDeadline,
      async ({ version, lock }) => {
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

        let result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        const reactorDefinition: MongoDBProcessorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'END',
          version,
          connectionOptions: {
            connectionString,
            clientOptions: { directConnection: true },
          },
          ...(lock === 'custom'
            ? {
                lock: {
                  lock: {
                    tryAcquire: () => Promise.resolve(true),
                    release: () => Promise.resolve(),
                  },
                },
              }
            : {}),
          eachMessage: (event) => {
            if (event.metadata.streamName === streamName) result.push(event);
          },
        };

        const firstConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
        firstConsumer.reactor<GuestStayEvent>(reactorDefinition);

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = firstConsumer.start();
        try {
          await firstConsumer.whenStarted();

          await eventStore.appendToStream(streamName, firstBatch);
          await firstConsumer.whenCaughtUp();
          const { events: firstRunStored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(
              firstRunStored.slice(initialEvents.length),
            ),
          );
        } finally {
          await firstConsumer.close();
          await firstConsumerPromise;
        }

        // Run 2: process events appended while stopped
        const secondConsumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
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
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(
              stored.slice(initialEvents.length + firstBatch.length),
            ),
          );
        } finally {
          await secondConsumer.close();
          await secondConsumerPromise;
        }
      },
    );

    (['BEGINNING', 'END'] as const).forEach((startFrom) => {
      void it(
        `does not persist a reactor checkpoint across recreation when checkpoints are DISABLED (startFrom ${startFrom})`,
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

          const firstRun: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const secondRun: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];

          const firstConsumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          firstConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName)
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

          const secondConsumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          secondConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName)
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

          assertDeepEqual(
            withoutSubscriptionCheckpoint(firstRun),
            withoutSubscriptionCheckpoint(expectedFirstRun),
          );
          assertDeepEqual(
            withoutSubscriptionCheckpoint(secondRun),
            withoutSubscriptionCheckpoint(expectedSecondRun),
          );
        },
      );

      void it(
        `does not persist a projector checkpoint across recreation when checkpoints are DISABLED (startFrom ${startFrom})`,
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

          const firstRun: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const secondRun: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const connectionOptions = {
            connectionString,
            clientOptions: { directConnection: true },
          };

          const firstConsumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          firstConsumer.projector<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            connectionOptions,
            projection: collectingProjection(
              firstRun,
              streamName,
              projectionName,
            ),
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

          const secondConsumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          secondConsumer.projector<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            connectionOptions,
            projection: collectingProjection(
              secondRun,
              streamName,
              projectionName,
            ),
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

          assertDeepEqual(
            withoutSubscriptionCheckpoint(firstRun),
            withoutSubscriptionCheckpoint(expectedFirstRun),
          );
          assertDeepEqual(
            withoutSubscriptionCheckpoint(secondRun),
            withoutSubscriptionCheckpoint(expectedSecondRun),
          );
        },
      );
    });

    void it(
      'handles ONLY events matching canHandle filter',
      withDeadline,
      async () => {
        // Given
        const guestId = uuid();
        const otherGuestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const events: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId } },
          { type: 'GuestCheckedOut', data: { guestId } },
          { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: otherGuestId } },
        ];
        await eventStore.appendToStream(streamName, events);

        const result: ReadEvent<
          GuestStayEvent,
          MongoDBChangeStreamMessageMetadata
        >[] = [];

        // When
        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
          processors: [
            inMemoryReactor<GuestStayEvent>({
              processorId: uuid(),
              startFrom: 'BEGINNING',
              canHandle: ['GuestCheckedIn'], // Only handle check-in events
              stopAfter: (event) =>
                event.metadata.streamName === streamName &&
                event.type === 'GuestCheckedIn' &&
                event.data.guestId === otherGuestId,
              eachMessage: (event) => {
                if (event.metadata.streamName === streamName)
                  result.push(event);
              },
            }),
          ],
        });

        try {
          await consumer.start();

          // Then - should only have GuestCheckedIn events, not GuestCheckedOut
          const { events: stored } =
            await eventStore.readStream<GuestStayEvent>(streamName);
          assertDeepEqual(
            withoutSubscriptionCheckpoint(result),
            withoutSubscriptionCheckpoint(
              stored.filter((event) => event.type === 'GuestCheckedIn'),
            ),
          );
        } finally {
          await consumer.close();
        }
      },
    );

    void describe('processor checkpoints', () => {
      void it(
        'resumes each processor from its own checkpoint while retaining messages',
        withDeadline,
        async () => {
          const guestId = uuid();
          const streamName = `guestStay-${guestId}`;
          const resumedProcessorId = uuid();
          const newProcessorId = uuid();
          const initialEvent: GuestStayEvent = {
            type: 'GuestCheckedIn',
            data: { guestId },
          };
          const newEvent: GuestStayEvent = {
            type: 'GuestCheckedOut',
            data: { guestId },
          };

          await eventStore.appendToStream(streamName, [initialEvent]);

          const initialConsumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          initialConsumer.reactor<GuestStayEvent>({
            processorId: resumedProcessorId,
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 1n,
            eachMessage: () => undefined,
          });

          try {
            await initialConsumer.start();
          } finally {
            await initialConsumer.close();
          }

          await eventStore.appendToStream(streamName, [newEvent]);

          const resumedProcessorResult: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const newProcessorResult: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const consumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });

          consumer.reactor<GuestStayEvent>({
            processorId: resumedProcessorId,
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 2n,
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName)
                resumedProcessorResult.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: newProcessorId,
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 2n,
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName)
                newProcessorResult.push(event);
            },
          });

          try {
            await consumer.start();

            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(
              withoutSubscriptionCheckpoint(resumedProcessorResult),
              withoutSubscriptionCheckpoint(stored.slice(1)),
            );
            assertDeepEqual(
              withoutSubscriptionCheckpoint(newProcessorResult),
              withoutSubscriptionCheckpoint(stored),
            );
          } finally {
            await consumer.close();
          }
        },
      );

      void it(
        'processes events in concurrent consumers with separate checkpoints',
        withDeadline,
        async () => {
          const guestId = uuid();
          const streamName = `guestStay-${guestId}`;
          const event: GuestStayEvent = {
            type: 'GuestCheckedIn',
            data: { guestId },
          };
          const firstResult: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const secondResult: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];

          const createConsumer = (
            processorId: string,
            result: ReadEvent<
              GuestStayEvent,
              MongoDBChangeStreamMessageMetadata
            >[],
          ) => {
            const consumer = mongoDBEventStoreConsumer({
              connectionString,
              clientOptions: { directConnection: true },
            });

            consumer.reactor<GuestStayEvent>({
              processorId,
              startFrom: 'END',
              connectionOptions: {
                connectionString,
                clientOptions: { directConnection: true },
              },
              eachMessage: (message) => {
                if (message.metadata.streamName !== streamName) return;

                result.push(message);
              },
            });

            return consumer;
          };

          const firstConsumer = createConsumer(uuid(), firstResult);
          const secondConsumer = createConsumer(uuid(), secondResult);
          const firstConsumerPromise = firstConsumer.start();
          const secondConsumerPromise = secondConsumer.start();

          try {
            await Promise.all([
              firstConsumer.whenStarted(),
              secondConsumer.whenStarted(),
            ]);

            await eventStore.appendToStream(streamName, [event]);
            await Promise.all([
              firstConsumer.whenCaughtUp(),
              secondConsumer.whenCaughtUp(),
            ]);

            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(
              withoutSubscriptionCheckpoint(firstResult),
              withoutSubscriptionCheckpoint(stored),
            );
            assertDeepEqual(
              withoutSubscriptionCheckpoint(secondResult),
              withoutSubscriptionCheckpoint(stored),
            );
          } finally {
            await Promise.all([firstConsumer.close(), secondConsumer.close()]);
            await Promise.all([firstConsumerPromise, secondConsumerPromise]);
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

          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);

          const consumer1 = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          consumer1.reactor<GuestStayEvent>({
            processorId,
            startFrom: 'BEGINNING',
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 1n,
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
          await eventStore.appendToStream(streamName, [nextEvent]);
          const result: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];

          const consumer2 = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          consumer2.reactor<GuestStayEvent>({
            processorId,
            startFrom: 'BEGINNING',
            connectionOptions: {
              connectionString,
              clientOptions: { directConnection: true },
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 2n,
            eachMessage: (event) => {
              if (event.metadata.streamName === streamName) result.push(event);
            },
          });

          try {
            await consumer2.start();
            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(
              withoutSubscriptionCheckpoint(result),
              withoutSubscriptionCheckpoint(stored.slice(1)),
            );
          } finally {
            await consumer2.close();
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

          const fromBeginning: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];
          const fromEnd: ReadEvent<
            GuestStayEvent,
            MongoDBChangeStreamMessageMetadata
          >[] = [];

          // When
          const consumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
            processors: [
              inMemoryReactor<GuestStayEvent>({
                processorId: uuid(),
                startFrom: 'BEGINNING',
                eachMessage: (event) => {
                  if (event.metadata.streamName === streamName)
                    fromBeginning.push(event);
                },
              }),
              inMemoryReactor<GuestStayEvent>({
                processorId: uuid(),
                startFrom: 'END',
                eachMessage: (event) => {
                  if (event.metadata.streamName === streamName)
                    fromEnd.push(event);
                },
              }),
            ],
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

            const { events: stored } =
              await eventStore.readStream<GuestStayEvent>(streamName);
            assertDeepEqual(
              withoutSubscriptionCheckpoint(fromBeginning),
              withoutSubscriptionCheckpoint(stored),
            );
            assertDeepEqual(
              withoutSubscriptionCheckpoint(fromEnd),
              withoutSubscriptionCheckpoint(stored.slice(initialEvents.length)),
            );
          } finally {
            await consumer.close();
            await consumerPromise;
          }
        },
      );
    });
  });

  void describe('message store', () => {
    const appendedThroughMessageStore = async (
      store: MongoDBEventStore,
      streamName: string,
      orderStreamName: string,
    ) => {
      const {
        events: [handled],
      } = await eventStore.readStream<GuestStayEvent>(streamName);
      const { events } =
        await store.readStream<GuestStayEvent>(orderStreamName);
      assertOk(handled);

      return {
        actual: events.map(({ type, kind, schemaVersion, data, metadata }) => ({
          type,
          kind,
          schemaVersion,
          data,
          streamName: metadata.streamName,
          streamPosition: metadata.streamPosition,
          correlationId: metadata.correlationId,
          causationId: metadata.causationId,
        })),
        handled,
      };
    };

    void it(
      "MongoDB reactor appends through the session's message store",
      withDeadline,
      async () => {
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const orderStreamName = `order-${uuid()}`;
        await eventStore.appendToStream<GuestStayEvent>(streamName, [
          { type: 'GuestCheckedIn', data: { guestId } },
        ]);

        const consumer = mongoDBEventStoreConsumer({
          connectionString,
          clientOptions: { directConnection: true },
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          connectionOptions: {
            connectionString,
            clientOptions: { directConnection: true },
          },
          eachMessage: async (message, context) => {
            if (message.metadata.streamName !== streamName) return;

            await context.session.messageStore.appendToStream<GuestStayEvent>(
              orderStreamName,
              [{ type: 'GuestCheckedIn', data: message.data }],
            );
          },
          stopAfter: (event) =>
            event.metadata.streamName === streamName &&
            event.metadata.streamPosition === 1n,
        });

        try {
          await consumer.start();
        } finally {
          await consumer.close();
        }

        const { actual, handled } = await appendedThroughMessageStore(
          eventStore,
          streamName,
          orderStreamName,
        );
        assertDeepEqual(actual, [
          {
            type: 'GuestCheckedIn',
            kind: 'Event',
            schemaVersion: 1,
            data: { guestId },
            streamName: orderStreamName,
            streamPosition: 1n,
            correlationId: handled.metadata.correlationId,
            causationId: handled.metadata.messageId,
          },
        ]);
      },
    );

    void it(
      'MongoDB reactor created with its own client gets the session client and message store from that client',
      withDeadline,
      async () => {
        const reactorDatabase = sharedMongoDBDatabase();
        const reactorClient = new MongoClient(
          reactorDatabase.connectionString,
          { directConnection: true },
        );
        const reactorStore = getMongoDBEventStore({ client: reactorClient });
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;
        const orderStreamName = `order-${uuid()}`;
        const sessionClients: MongoClient[] = [];

        try {
          await eventStore.appendToStream<GuestStayEvent>(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);

          const consumer = mongoDBEventStoreConsumer({
            connectionString,
            clientOptions: { directConnection: true },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            connectionOptions: { client: reactorClient },
            eachMessage: async (message, context) => {
              if (message.metadata.streamName !== streamName) return;

              sessionClients.push(context.session.client);
              await context.session.messageStore.appendToStream<GuestStayEvent>(
                orderStreamName,
                [{ type: 'GuestCheckedIn', data: message.data }],
              );
            },
            stopAfter: (event) =>
              event.metadata.streamName === streamName &&
              event.metadata.streamPosition === 1n,
          });

          try {
            await consumer.start();
          } finally {
            await consumer.close();
          }

          const { actual, handled } = await appendedThroughMessageStore(
            reactorStore,
            streamName,
            orderStreamName,
          );
          const { events: inConsumerStore } =
            await eventStore.readStream<GuestStayEvent>(orderStreamName);
          assertEqual(sessionClients.length, 1);
          assertOk(sessionClients[0] === reactorClient);
          assertDeepEqual(inConsumerStore, []);
          assertDeepEqual(actual, [
            {
              type: 'GuestCheckedIn',
              kind: 'Event',
              schemaVersion: 1,
              data: { guestId },
              streamName: orderStreamName,
              streamPosition: 1n,
              correlationId: handled.metadata.correlationId,
              causationId: handled.metadata.messageId,
            },
          ]);
        } finally {
          await reactorClient.close();
          await reactorDatabase.close();
        }
      },
    );
  });

  void describe('observability', () => {
    const given = ObservabilitySpec.for();

    const reactorStoppingAfterAppended = async (processorId: string) => {
      const streamName = `guestStay-${uuid()}`;
      const { nextExpectedStreamVersion } = await eventStore.appendToStream(
        streamName,
        [{ type: 'GuestCheckedIn', data: { guestId: uuid() } }],
      );
      return inMemoryReactor<GuestStayEvent>({
        processorId,
        stopAfter: (event) =>
          event.metadata.streamName === streamName &&
          event.metadata.streamPosition === nextExpectedStreamVersion,
        eachMessage: () => {},
      });
    };

    void it(
      'processor lifecycle logs and spans reach the configured observability',
      withDeadline,
      async () => {
        const processorId = uuid();
        const reactor = await reactorStoppingAfterAppended(processorId);

        await given((observability) =>
          mongoDBEventStoreConsumer({
            connectionString,
            processors: [reactor],
            clientOptions: { directConnection: true },
            observability,
          }),
        )
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
      'a consumer with no observability configured logs nothing',
      withDeadline,
      async () => {
        const reactor = await reactorStoppingAfterAppended(uuid());
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
          const consumer = mongoDBEventStoreConsumer({
            connectionString,
            processors: [reactor],
            clientOptions: { directConnection: true },
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
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type NumberRecorded = Event<'NumberRecorded', { number: number }>;
