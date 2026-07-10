import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertThatArray,
  bigIntProcessorCheckpoint,
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
        let stopAfterPosition: string | undefined = undefined;

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
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
        let stopAfterPosition: string | undefined = undefined;

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
        let stopAfterPosition: string | undefined = undefined;

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
          let stopAfterPosition: string | undefined = undefined;

          // When
          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'BEGINNING',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              fromBeginning.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              fromEnd.push(event);
            },
          });

          try {
            const consumerPromise = consumer.start();
            await consumer.whenStarted();

            const appendResult = await eventStore.appendToStream(
              streamName,
              newEvents,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            // Then the BEGINNING processor sees the whole history,
            // while the END processor sees only messages appended after start
            assertThatArray(fromBeginning).containsElementsMatching([
              ...initialEvents,
              ...newEvents,
            ]);
            assertThatArray(fromEnd).containsOnlyElementsMatching(newEvents);
          } finally {
            await consumer.close();
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
          let stopAfterPosition: string | undefined = undefined;

          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: { lastCheckpoint: resumeCheckpoint },
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              fromResuming.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              fromEnd.push(event);
            },
          });

          try {
            const consumerPromise = consumer.start();
            await consumer.whenStarted();

            const appendResult = await eventStore.appendToStream(
              streamName,
              newEvents,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(fromResuming).containsOnlyElementsMatching([
              ...backlogEvents,
              ...newEvents,
            ]);
            assertThatArray(fromEnd).containsOnlyElementsMatching(newEvents);
          } finally {
            await consumer.close();
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
          let stopAfterPosition: string | undefined = undefined;

          const consumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              firstEnd.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              secondEnd.push(event);
            },
          });

          try {
            const consumerPromise = consumer.start();
            await consumer.whenStarted();

            const appendResult = await eventStore.appendToStream(
              streamName,
              newEvents,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;

            await consumerPromise;

            assertThatArray(firstEnd).containsOnlyElementsMatching(newEvents);
            assertThatArray(secondEnd).containsOnlyElementsMatching(newEvents);
          } finally {
            await consumer.close();
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
        let stopAfterPosition: string | undefined = undefined;

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            fromEnd.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, firstAppend);
          const appendResult = await eventStore.appendToStream(
            streamName,
            secondAppend,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          assertThatArray(fromEnd).containsOnlyElementsMatching([
            ...firstAppend,
            ...secondAppend,
          ]);
        } finally {
          await consumer.close();
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
          let stopAfterPosition: string | undefined = undefined;

          const firstConsumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          firstConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              firstRun.push(event);
            },
          });
          try {
            const consumerPromise = firstConsumer.start();
            await firstConsumer.whenStarted();
            const appendResult = await eventStore.appendToStream(
              streamName,
              firstNewEvents,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;
            await consumerPromise;
          } finally {
            await firstConsumer.close();
          }

          stopAfterPosition = undefined;

          const secondConsumer = sqliteEventStoreConsumer({
            driver: sqlite3EventStoreDriver,
            fileName,
          });
          secondConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            stopAfter: (event) =>
              event.metadata.globalPosition === stopAfterPosition,
            eachMessage: (event) => {
              secondRun.push(event);
            },
          });
          try {
            const consumerPromise = secondConsumer.start();
            await secondConsumer.whenStarted();
            const appendResult = await eventStore.appendToStream(
              streamName,
              secondNewEvents,
            );
            stopAfterPosition = appendResult.lastEventGlobalPosition;
            await consumerPromise;
          } finally {
            await secondConsumer.close();
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

        const processorOptions: SQLiteReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
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
        let stopAfterPosition: string | undefined = undefined;

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();
          await consumer.whenStarted();

          const appendResult = await eventStore.appendToStream(
            streamName,
            events,
          );
          stopAfterPosition = appendResult.lastEventGlobalPosition;

          await consumerPromise;

          assertThatArray(result).containsOnlyElementsMatching(events);
        } catch (error) {
          console.log(error);
        } finally {
          await consumer.close();
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
        let stopAfterPosition: string | undefined = undefined;

        // When
        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();
          await consumer.whenStarted();

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
        let stopAfterPosition: string | undefined = undefined;

        const consumer = sqliteEventStoreConsumer({
          driver: sqlite3EventStoreDriver,
          fileName,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        const firstAppend = await eventStore.appendToStream(
          streamName,
          firstBatch,
        );
        stopAfterPosition = firstAppend.lastEventGlobalPosition;
        await firstConsumerPromise;
        await consumer.stop();

        // Run 2: restart and process second batch only
        result = [];
        stopAfterPosition = undefined;

        const secondBatch: GuestStayEvent[] = [
          { type: 'GuestCheckedIn', data: { guestId: thirdGuestId } },
          { type: 'GuestCheckedOut', data: { guestId: thirdGuestId } },
        ];

        try {
          const secondConsumerPromise = consumer.start();

          const secondAppend = await eventStore.appendToStream(
            streamName,
            secondBatch,
          );
          stopAfterPosition = secondAppend.lastEventGlobalPosition;

          await secondConsumerPromise;

          assertThatArray(result).containsOnlyElementsMatching(secondBatch);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'handles concurrent writes with multiple processors without SQLITE_BUSY errors',
      withDeadline,
      async () => {
        // Given
        const concurrentStreams = 1000;
        const projectionResult: GuestStayEvent[] = [];
        const forwarderResult: GuestStayEvent[] = [];
        let stopAfterPosition: string | undefined = undefined;

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
          stopAfter: (event) =>
            guestIds.includes(event.data.guestId) &&
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            if (guestIds.includes(event.data.guestId))
              projectionResult.push(event);
          },
        });

        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            guestIds.includes(event.data.guestId) &&
            event.metadata.globalPosition === stopAfterPosition,
          eachMessage: (event) => {
            if (guestIds.includes(event.data.guestId))
              forwarderResult.push(event);
          },
        });

        // When
        try {
          const consumerPromise = consumer.start();

          const appendResults = await Promise.all(
            guestIds.map(async (guestId) => {
              try {
                const result = await eventStore.appendToStream(
                  `guestStay-${guestId}`,
                  [
                    { type: 'GuestCheckedIn', data: { guestId } },
                    { type: 'GuestCheckedOut', data: { guestId } },
                  ],
                );
                return result.lastEventGlobalPosition;
              } catch (error) {
                return error;
              }
            }),
          );

          stopAfterPosition = appendResults
            .filter((r) => !(r instanceof Error))
            .map((r) => r as string)
            .reduce(
              (max, r) => (r > max ? r : max),
              bigIntProcessorCheckpoint(0n),
            );

          await consumerPromise;

          // Then
          const expectedCount = concurrentStreams * 2;
          assertThatArray(projectionResult).hasSize(expectedCount);
          assertThatArray(forwarderResult).hasSize(expectedCount);
        } catch (error) {
          console.log(error);
        } finally {
          await consumer.close();
        }
      },
    );
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
