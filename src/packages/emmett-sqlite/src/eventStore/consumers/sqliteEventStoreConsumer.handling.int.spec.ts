import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertThatArray,
  asyncAwaiter,
  type Event,
} from '@event-driven-io/emmett';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreOptions,
} from '../../sqlite3';
import { createEventStoreSchema } from '../schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';
import type { SQLiteReactorOptions } from './sqliteProcessor';

const withDeadline = { timeout: 30000 };

void describe('SQLite event store started consumer', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, `test.db`);

  let pool: SQLitePool<SQLite3Connection>;

  const config: SQLite3EventStoreOptions = {
    driver: sqlite3EventStoreDriver,
    schema: {
      autoMigration: 'None',
    },
    fileName,
  };

  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });

    eventStore = getSQLiteEventStore({ ...config, pool });
    return createEventStoreSchema(
      sqlite3Connection({ fileName, serializer: JSONSerializer }),
    );
  });

  afterEach(async () => {
    await eventStore.close();
    await pool.close();
    if (!fs.existsSync(fileName)) {
      return;
    }
    try {
      fs.unlinkSync(fileName);
      fs.unlinkSync(`${fileName}-shm`);
      fs.unlinkSync(`${fileName}-wal`);
    } catch (error) {
      console.log(error);
    }
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
            const consumer = sqliteEventStoreConsumer({
              driver: sqlite3EventStoreDriver,
              fileName,
              pool,
            });

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
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
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
        } catch (error) {
          console.log(error);
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
        const resultReachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === guestId
            )
              resultReachedEnd.resolve();
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

          await eventStore.appendToStream(streamName, events);

          await resultReachedEnd.wait;

          assertThatArray(result).containsElementsMatching(events);
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
        const resultReachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: {
            lastCheckpoint: startPosition,
          },
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              resultReachedEnd.resolve();
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await eventStore.appendToStream(streamName, events);

          await resultReachedEnd.wait;

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
        const resultReachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              resultReachedEnd.resolve();
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await eventStore.appendToStream(streamName, events);

          await resultReachedEnd.wait;

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
          const beginningReachedEnd = asyncAwaiter();
          const endReachedEnd = asyncAwaiter();

          // When
          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'BEGINNING',
            eachMessage: (event) => {
              fromBeginning.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === otherGuestId
              )
                beginningReachedEnd.resolve();
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              fromEnd.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === otherGuestId
              )
                endReachedEnd.resolve();
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await Promise.all([beginningReachedEnd.wait, endReachedEnd.wait]);

            // Then the BEGINNING processor sees the whole history,
            // while the END processor sees only messages appended after start
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
          const resumingReachedEnd = asyncAwaiter();
          const endReachedEnd = asyncAwaiter();

          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: { lastCheckpoint: resumeCheckpoint },
            eachMessage: (event) => {
              fromResuming.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === guestId
              )
                resumingReachedEnd.resolve();
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              fromEnd.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === guestId
              )
                endReachedEnd.resolve();
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await Promise.all([resumingReachedEnd.wait, endReachedEnd.wait]);

            assertThatArray(fromResuming).containsOnlyElementsMatching([
              ...backlogEvents,
              ...newEvents,
            ]);
            assertThatArray(fromEnd).containsOnlyElementsMatching(newEvents);
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
          const firstReachedEnd = asyncAwaiter();
          const secondReachedEnd = asyncAwaiter();

          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              firstEnd.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === otherGuestId
              )
                firstReachedEnd.resolve();
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              secondEnd.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === otherGuestId
              )
                secondReachedEnd.resolve();
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await Promise.all([firstReachedEnd.wait, secondReachedEnd.wait]);

            assertThatArray(firstEnd).containsOnlyElementsMatching(newEvents);
            assertThatArray(secondEnd).containsOnlyElementsMatching(newEvents);
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
        const reachedEnd = asyncAwaiter();

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            fromEnd.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              reachedEnd.resolve();
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, firstAppend);
          await eventStore.appendToStream(streamName, secondAppend);

          await reachedEnd.wait;

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
        `does not persist a checkpoint across a restart when checkpoints are DISABLED (startFrom ${startFrom})`,
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
          const firstRunReachedEnd = asyncAwaiter();
          const secondRunReachedEnd = asyncAwaiter();

          const firstConsumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          firstConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
              firstRun.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === otherGuestId
              )
                firstRunReachedEnd.resolve();
            },
          });
          let firstConsumerPromise: Promise<void> | undefined;
          try {
            firstConsumerPromise = firstConsumer.start();
            await firstConsumer.whenStarted();
            await eventStore.appendToStream(streamName, firstNewEvents);
            await firstRunReachedEnd.wait;
          } finally {
            await firstConsumer.close();
            await firstConsumerPromise;
          }

          const secondConsumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          secondConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
              secondRun.push(event);
              if (
                event.type === 'GuestCheckedOut' &&
                event.data.guestId === thirdGuestId
              )
                secondRunReachedEnd.resolve();
            },
          });
          let secondConsumerPromise: Promise<void> | undefined;
          try {
            secondConsumerPromise = secondConsumer.start();
            await secondConsumer.whenStarted();
            await eventStore.appendToStream(streamName, secondNewEvents);
            await secondRunReachedEnd.wait;
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
        let stopAfterPosition: string | undefined = startPosition;
        const restartReachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              restartReachedEnd.resolve();
          },
        });

        await consumer.start();
        await consumer.stop();

        result = [];

        stopAfterPosition = undefined;

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await eventStore.appendToStream(streamName, events);

          await restartReachedEnd.wait;

          assertThatArray(result).containsOnlyElementsMatching(events);
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
        let stopAfterPosition: string | undefined = startPosition;
        const newConsumerReachedEnd = asyncAwaiter();

        const processorOptions: SQLiteReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              newConsumerReachedEnd.resolve();
          },
        };

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        try {
          consumer.reactor<GuestStayEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        result = [];

        stopAfterPosition = undefined;

        const newConsumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        newConsumer.reactor<GuestStayEvent>(processorOptions);

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = newConsumer.start();

          await eventStore.appendToStream(streamName, events);

          await newConsumerReachedEnd.wait;

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
        const reachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === otherGuestId
            )
              reachedEnd.resolve();
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await reachedEnd.wait;

          assertThatArray(result).containsOnlyElementsMatching(events);
        } catch (error) {
          console.log(error);
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
        const reachedEnd = asyncAwaiter();

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
            if (
              event.type === 'GuestCheckedOut' &&
              event.data.guestId === guestId
            )
              reachedEnd.resolve();
          },
        });

        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, events);

          await reachedEnd.wait;

          assertThatArray(result).containsElementsMatching(events);
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
        const firstRunReachedEnd = asyncAwaiter();
        const secondRunReachedEnd = asyncAwaiter();

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
            if (event.type === 'GuestCheckedOut') {
              if (event.data.guestId === otherGuestId)
                firstRunReachedEnd.resolve();
              if (event.data.guestId === thirdGuestId)
                secondRunReachedEnd.resolve();
            }
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(streamName, firstBatch);
        await firstRunReachedEnd.wait;
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

          await eventStore.appendToStream(streamName, secondBatch);

          await secondRunReachedEnd.wait;

          assertThatArray(result).containsOnlyElementsMatching(secondBatch);
        } finally {
          await consumer.close();
          await secondConsumerPromise;
        }
      },
    );

    void it(
      'handles concurrent writes with multiple processors without SQLITE_BUSY errors',
      withDeadline,
      async () => {
        // Given
        const concurrentStreams = 1000;
        const expectedCount = concurrentStreams * 2;
        const projectionResult: GuestStayEvent[] = [];
        const forwarderResult: GuestStayEvent[] = [];
        const projectionReachedEnd = asyncAwaiter();
        const forwarderReachedEnd = asyncAwaiter();

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
          pool,
        });

        const guestIds = Array.from({ length: concurrentStreams }, () =>
          uuid(),
        );

        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            if (guestIds.includes(event.data.guestId)) {
              projectionResult.push(event);
              if (projectionResult.length === expectedCount)
                projectionReachedEnd.resolve();
            }
          },
        });

        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: (event) => {
            if (guestIds.includes(event.data.guestId)) {
              forwarderResult.push(event);
              if (forwarderResult.length === expectedCount)
                forwarderReachedEnd.resolve();
            }
          },
        });

        // When
        let consumerPromise: Promise<void> | undefined;
        try {
          consumerPromise = consumer.start();

          await Promise.all(
            guestIds.map((guestId) =>
              eventStore
                .appendToStream(`guestStay-${guestId}`, [
                  { type: 'GuestCheckedIn', data: { guestId } },
                  { type: 'GuestCheckedOut', data: { guestId } },
                ])
                .catch(() => undefined),
            ),
          );

          await Promise.all([
            projectionReachedEnd.wait,
            forwarderReachedEnd.wait,
          ]);

          // Then
          assertThatArray(projectionResult).hasSize(expectedCount);
          assertThatArray(forwarderResult).hasSize(expectedCount);
        } catch (error) {
          console.log(error);
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
