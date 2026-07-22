import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import type { EmmettError } from '@event-driven-io/emmett';
import {
  assertEqual,
  assertThatArray,
  assertThrowsAsync,
  asyncAwaiter,
  defaultTag,
  type Event,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLProcessorLock } from '../projections';
import {
  PostgreSQLEventStoreCheckpoint,
  storeProcessorCheckpoint,
} from '../schema';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import {
  postgreSQLReactor,
  type PostgreSQLReactorOptions,
} from './postgreSQLProcessor';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store started consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pool: Dumbo;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
    pool = dumbo({
      connectionString,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    });
  });

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({
      resetSequences: true,
      truncateProjections: true,
    });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await eventStore?.close();
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void describe('eachMessage', () => {
    void it(
      'handles all events appended to event store BEFORE reactor was started',
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
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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
      'handles all events appended to event store AFTER reactor was started',
      withDeadline,
      async () => {
        // Given

        const result: GuestStayEvent[] = [];

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
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
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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
          await consumer.whenStarted();

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

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        await consumer.start();
        await consumer.stop();

        result = [];

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

        const processorOptions: PostgreSQLReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) => event.metadata.globalPosition === startPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        };

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        try {
          consumer.reactor<GuestStayEvent>(processorOptions);

          await consumer.start();
        } finally {
          await consumer.close();
        }

        result = [];

        const newConsumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        newConsumer.reactor<GuestStayEvent>(processorOptions);

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
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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

        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            result.push(event);
          },
        });

        // Run 1: process first batch appended after END start
        const firstConsumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(streamName, firstBatch);
        await consumer.whenCaughtUp();
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
          await consumer.whenStarted();

          await eventStore.appendToStream(streamName, secondBatch);

          await consumer.whenCaughtUp();

          assertThatArray(result).containsOnlyElementsMatching(secondBatch);
        } finally {
          await consumer.close();
          await secondConsumerPromise;
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

          // When
          const consumer = postgreSQLEventStoreConsumer({
            connectionString,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'BEGINNING',
            eachMessage: (event) => {
              fromBeginning.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              fromEnd.push(event);
            },
          });

          let consumerPromise: Promise<void> | undefined;
          try {
            consumerPromise = consumer.start();
            await consumer.whenStarted();

            await eventStore.appendToStream(streamName, newEvents);

            await consumer.whenCaughtUp();

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

          const consumer = postgreSQLEventStoreConsumer({
            connectionString,
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

          const consumer = postgreSQLEventStoreConsumer({
            connectionString,
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              firstEnd.push(event);
            },
          });
          consumer.reactor<GuestStayEvent>({
            processorId: uuid(),
            startFrom: 'END',
            eachMessage: (event) => {
              secondEnd.push(event);
            },
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

        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'END',
          eachMessage: (event) => {
            fromEnd.push(event);
          },
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

          const firstConsumer = postgreSQLEventStoreConsumer({
            connectionString,
          });
          firstConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
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

          const secondConsumer = postgreSQLEventStoreConsumer({
            connectionString,
          });
          secondConsumer.reactor<GuestStayEvent>({
            processorId,
            startFrom,
            checkpoints: 'DISABLED',
            eachMessage: (event) => {
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

        const result: GuestStayEvent[] = [];

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
        });
        consumer.reactor<GuestStayEvent>({
          processorId: uuid(),
          startFrom: 'CURRENT',
          canHandle: ['GuestCheckedIn'], // Only handle check-in events
          stopAfter: (event) =>
            event.type === 'GuestCheckedIn' &&
            event.data.guestId === otherGuestId,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          const consumerPromise = consumer.start();

          await eventStore.appendToStream(streamName, events);

          await consumerPromise;

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
  });

  void describe('SIGTERM shutdown', () => {
    void it(
      'closes PostgreSQL processor without error on SIGTERM',
      withDeadline,
      async () => {
        // Given
        const pool = dumbo({
          connectionString,
          transactionOptions: {
            allowNestedTransactions: true,
          },
        });
        const processor = postgreSQLReactor<GuestStayEvent>({
          processorId: uuid(),
          eachMessage: () => Promise.resolve(),
        });

        const startOptions = {
          execute: pool.execute,
          connection: { connectionString, pool },
        } as Parameters<typeof processor.start>[0];

        await processor.start(startOptions);

        // When
        process.emit('SIGTERM');
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Then
        assertEqual(processor.isActive, false);

        await pool?.close();
      },
    );
  });

  void describe('processor lock', () => {
    void it(
      'fails to start when another instance holds the processor lock',
      withDeadline,
      async () => {
        const processorId = uuid();

        const otherInstanceLock = postgreSQLProcessorLock({
          processorId,
          version: 1,
          partition: defaultTag,
          processorInstanceId: 'other-crashed-instance',
        });
        await pool.withConnection((connection) =>
          otherInstanceLock.tryAcquire({ execute: connection.execute }),
        );

        const consumer = postgreSQLEventStoreConsumer({ connectionString });
        consumer.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'CURRENT',
          eachMessage: () => {},
        });

        try {
          await assertThrowsAsync<EmmettError>(
            () => consumer.start(),
            (error) => error.message.includes(processorId),
          );
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'resumes from saved checkpoint after crash when lockTimeoutSeconds is 0',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const { lastEventGlobalPosition: firstPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);

        const { lastEventGlobalPosition: secondPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);

        const crashedInstanceLock = postgreSQLProcessorLock({
          processorId,
          version: 1,
          partition: defaultTag,
          processorInstanceId: 'crashed-instance',
        });
        await pool.withConnection((connection) =>
          crashedInstanceLock.tryAcquire({ execute: connection.execute }),
        );
        await storeProcessorCheckpoint(pool.execute, {
          processorId,
          version: 1,
          newCheckpoint: firstPosition,
          lastProcessedCheckpoint:
            PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
              transactionId: 0n,
              globalPosition: 0n,
            }),
          partition: defaultTag,
          processorInstanceId: 'crashed-instance',
        });

        const result: GuestStayEvent[] = [];

        const consumer = postgreSQLEventStoreConsumer({ connectionString });
        consumer.reactor<GuestStayEvent>({
          processorId,
          stopAfter: (event) =>
            event.metadata.globalPosition === secondPosition,
          lock: { timeoutSeconds: 0 },
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer.start();

          assertThatArray(result).containsOnlyElementsMatching([
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'second consumer with same processorId fails while first consumer is running',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();

        await eventStore.appendToStream(`guestStay-${guestId}`, [
          { type: 'GuestCheckedIn', data: { guestId } },
        ]);

        let resolveConsumer1HasLock!: () => void;
        const consumer1HasLock = new Promise<void>((resolve) => {
          resolveConsumer1HasLock = resolve;
        });

        const consumer1 = postgreSQLEventStoreConsumer({ connectionString });
        consumer1.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'CURRENT',
          eachMessage: () => {
            resolveConsumer1HasLock();
          },
        });

        consumer1.start().catch(console.error);
        await consumer1HasLock;

        const consumer2 = postgreSQLEventStoreConsumer({ connectionString });
        consumer2.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'CURRENT',
          eachMessage: () => {},
        });

        try {
          await assertThrowsAsync<EmmettError>(
            () => consumer2.start(),
            (error) => error.message.includes(processorId),
          );
        } finally {
          await Promise.allSettled([consumer1.close(), consumer2.close()]);
        }
      },
    );

    void it(
      'new consumer with same processorId starts after previous consumer stops gracefully',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [{ type: 'GuestCheckedIn', data: { guestId } }],
        );

        const consumer1 = postgreSQLEventStoreConsumer({ connectionString });
        consumer1.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'BEGINNING',
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: () => {},
        });
        try {
          await consumer1.start();
        } finally {
          await consumer1.close();
        }

        const consumer2 = postgreSQLEventStoreConsumer({ connectionString });
        consumer2.reactor<GuestStayEvent>({
          processorId,
          startFrom: 'BEGINNING',
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: () => {},
        });

        try {
          await consumer2.start();
        } finally {
          await consumer2.close();
        }
      },
    );

    void it(
      'new consumer resumes from checkpoint saved by previous consumer after graceful stop',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const { lastEventGlobalPosition: firstPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);

        const consumer1 = postgreSQLEventStoreConsumer({ connectionString });
        consumer1.reactor<GuestStayEvent>({
          processorId,
          stopAfter: (event) => event.metadata.globalPosition === firstPosition,
          eachMessage: () => {},
        });
        try {
          await consumer1.start();
        } finally {
          await consumer1.close();
        }

        const { lastEventGlobalPosition: secondPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);

        const result: GuestStayEvent[] = [];
        const consumer2 = postgreSQLEventStoreConsumer({ connectionString });
        consumer2.reactor<GuestStayEvent>({
          processorId,
          stopAfter: (event) =>
            event.metadata.globalPosition === secondPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer2.start();

          assertThatArray(result).containsOnlyElementsMatching([
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);
        } finally {
          await consumer2.close();
        }
      },
    );

    void it(
      'consumer with explicit processorInstanceId reclaims its own stale lock',
      withDeadline,
      async () => {
        const processorId = uuid();
        const processorInstanceId = `reconnecting-instance-${uuid()}`;
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const staleInstanceLock = postgreSQLProcessorLock({
          processorId,
          version: 1,
          partition: defaultTag,
          processorInstanceId,
        });
        await pool.withConnection((connection) =>
          staleInstanceLock.tryAcquire({ execute: connection.execute }),
        );

        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          streamName,
          [{ type: 'GuestCheckedIn', data: { guestId } }],
        );

        const result: GuestStayEvent[] = [];
        const consumer = postgreSQLEventStoreConsumer({ connectionString });
        consumer.reactor<GuestStayEvent>({
          processorId,
          processorInstanceId,
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer.start();

          assertThatArray(result).containsElementsMatching([
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'consumer waits for lock timeout before taking over a crashed processor',
      withDeadline,
      async () => {
        const processorId = uuid();
        const guestId = uuid();
        const streamName = `guestStay-${guestId}`;

        const { lastEventGlobalPosition: firstPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedIn', data: { guestId } },
          ]);
        const { lastEventGlobalPosition: secondPosition } =
          await eventStore.appendToStream(streamName, [
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);

        const crashedInstanceLock = postgreSQLProcessorLock({
          processorId,
          version: 1,
          partition: defaultTag,
          processorInstanceId: 'crashed-instance',
        });
        await pool.withTransaction((connection) =>
          crashedInstanceLock.tryAcquire({ execute: connection.execute }),
        );
        await storeProcessorCheckpoint(pool.execute, {
          processorId,
          version: 1,
          newCheckpoint: firstPosition,
          lastProcessedCheckpoint:
            PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
              transactionId: 0n,
              globalPosition: 0n,
            }),
          partition: defaultTag,
          processorInstanceId: 'crashed-instance',
        });

        const result: GuestStayEvent[] = [];
        const consumer = postgreSQLEventStoreConsumer({ connectionString });
        consumer.reactor<GuestStayEvent>({
          processorId,
          stopAfter: (event) =>
            event.metadata.globalPosition === secondPosition,
          lock: {
            timeoutSeconds: 1,
            acquisitionPolicy: {
              type: 'retry',
              retries: 10,
              minTimeout: 200,
              maxTimeout: 1000,
            },
          },
          eachMessage: (event) => {
            result.push(event);
          },
        });

        try {
          await consumer.start();

          assertThatArray(result).containsOnlyElementsMatching([
            { type: 'GuestCheckedOut', data: { guestId } },
          ]);
        } finally {
          await consumer.close();
        }
      },
    );

    void it(
      'concurrent consumers with different processorIds do not block each other',
      withDeadline,
      async () => {
        const guestId = uuid();
        const { lastEventGlobalPosition } = await eventStore.appendToStream(
          `guestStay-${guestId}`,
          [{ type: 'GuestCheckedIn', data: { guestId } }],
        );

        const result1: GuestStayEvent[] = [];
        const consumer1 = postgreSQLEventStoreConsumer({ connectionString });
        consumer1.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: (event) => {
            result1.push(event);
          },
        });

        const result2: GuestStayEvent[] = [];
        const consumer2 = postgreSQLEventStoreConsumer({ connectionString });
        consumer2.reactor<GuestStayEvent>({
          processorId: uuid(),
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: (event) => {
            result2.push(event);
          },
        });

        try {
          await Promise.all([consumer1.start(), consumer2.start()]);

          assertThatArray(result1).isNotEmpty();
          assertThatArray(result2).isNotEmpty();
        } finally {
          await Promise.all([consumer1.close(), consumer2.close()]);
        }
      },
    );
  });
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
