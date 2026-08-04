import {
  assertThatArray,
  delay,
  inMemoryReactor,
  type Closeable,
  type Event,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  sharedMongoDBDatabase,
  type SharedMongoDBDatabase,
} from '../../testing/sharedMongoDBDatabase';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '../mongoDBEventStore';
import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';
import type { MongoDBProjectorOptions } from './mongoDBProcessor';

const withDeadline = { timeout: 30000 };

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
    collected: GuestStayEvent[],
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

        const result: GuestStayEvent[] = [];

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

          assertThatArray(result).containsElementsMatching(events);
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

        const result: GuestStayEvent[] = [];

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

          assertThatArray(result).containsOnlyElementsMatching(events);
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

        let result: GuestStayEvent[] = [];

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

          assertThatArray(result).containsOnlyElementsMatching(events);
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

          assertThatArray(result).containsOnlyElementsMatching(events);
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

          assertThatArray(result).containsElementsMatching(events);
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

        const firstEnd: GuestStayEvent[] = [];
        const secondEnd: GuestStayEvent[] = [];

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

          assertThatArray(firstEnd).containsOnlyElementsMatching(newEvents);
          assertThatArray(secondEnd).containsOnlyElementsMatching(newEvents);
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

        const fromEnd: GuestStayEvent[] = [];

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

          assertThatArray(fromEnd).containsOnlyElementsMatching([
            ...firstAppend,
            ...secondAppend,
          ]);
        } finally {
          await consumer.close();
          await consumerPromise;
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

          const firstRun: GuestStayEvent[] = [];
          const secondRun: GuestStayEvent[] = [];

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

          const expectedFirstRun =
            startFrom === 'BEGINNING'
              ? [...initialEvents, ...firstNewEvents]
              : firstNewEvents;
          const expectedSecondRun =
            startFrom === 'BEGINNING'
              ? [...initialEvents, ...firstNewEvents, ...secondNewEvents]
              : secondNewEvents;

          assertThatArray(firstRun).containsOnlyElementsMatching(
            expectedFirstRun,
          );
          assertThatArray(secondRun).containsOnlyElementsMatching(
            expectedSecondRun,
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

          const firstRun: GuestStayEvent[] = [];
          const secondRun: GuestStayEvent[] = [];
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

          const expectedFirstRun =
            startFrom === 'BEGINNING'
              ? [...initialEvents, ...firstNewEvents]
              : firstNewEvents;
          const expectedSecondRun =
            startFrom === 'BEGINNING'
              ? [...initialEvents, ...firstNewEvents, ...secondNewEvents]
              : secondNewEvents;

          assertThatArray(firstRun).containsOnlyElementsMatching(
            expectedFirstRun,
          );
          assertThatArray(secondRun).containsOnlyElementsMatching(
            expectedSecondRun,
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

        const result: GuestStayEvent[] = [];

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
          assertThatArray(result).containsOnlyElementsMatching([
            { type: 'GuestCheckedIn', data: { guestId } },
            { type: 'GuestCheckedIn', data: { guestId: otherGuestId } },
          ]);
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

          const resumedProcessorResult: GuestStayEvent[] = [];
          const newProcessorResult: GuestStayEvent[] = [];
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

            assertThatArray(
              resumedProcessorResult,
            ).containsOnlyElementsMatching([newEvent]);
            assertThatArray(newProcessorResult).containsOnlyElementsMatching([
              initialEvent,
              newEvent,
            ]);
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
          const firstResult: GuestStayEvent[] = [];
          const secondResult: GuestStayEvent[] = [];

          const createConsumer = (
            processorId: string,
            result: GuestStayEvent[],
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

            assertThatArray(firstResult).containsOnlyElementsMatching([event]);
            assertThatArray(secondResult).containsOnlyElementsMatching([event]);
          } finally {
            await Promise.all([firstConsumer.close(), secondConsumer.close()]);
            await Promise.all([firstConsumerPromise, secondConsumerPromise]);
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
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;

type NumberRecorded = Event<'NumberRecorded', { number: number }>;
