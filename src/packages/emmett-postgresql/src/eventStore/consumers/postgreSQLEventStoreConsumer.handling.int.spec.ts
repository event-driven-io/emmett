import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  assertThatArray,
  assertThrowsAsync,
  EmmettError,
  type Event,
} from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLProcessorLock } from '../projections/locks';
import { defaultTag, storeProcessorCheckpoint } from '../schema';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';
import type { PostgreSQLReactorOptions } from './postgreSQLProcessor';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL event store started consumer', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let pool: Dumbo;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
    pool = dumbo({ connectionString });
  });

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({
      resetSequences: true,
      truncateProjections: true,
    });
  });

  after(async () => {
    try {
      await pool.close();
      await eventStore.close();
      await postgres.stop();
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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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
        let stopAfterPosition: bigint | undefined = undefined;

        // When
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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
        const consumer = postgreSQLEventStoreConsumer({
          connectionString,
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

        const processorOptions: PostgreSQLReactorOptions<GuestStayEvent> = {
          processorId: uuid(),
          startFrom: 'CURRENT',
          stopAfter: (event) =>
            event.metadata.globalPosition === stopAfterPosition,
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

        stopAfterPosition = undefined;

        const newConsumer = postgreSQLEventStoreConsumer({
          connectionString,
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

        await assertThrowsAsync<EmmettError>(
          () => consumer.start(),
          (error) => error.message.includes(processorId),
        );

        await consumer.close().catch(() => {});
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
          lastProcessedCheckpoint: 0n,
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

        const consumer1Promise = consumer1.start();
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
          await consumer1.stop();
          await consumer1Promise.catch(() => {});
          await consumer2.close().catch(() => {});
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
          stopAfter: (event) =>
            event.metadata.globalPosition === lastEventGlobalPosition,
          eachMessage: () => {},
        });
        try {
          await consumer1.start();
        } finally {
          await consumer1.stop();
        }

        const consumer2 = postgreSQLEventStoreConsumer({ connectionString });
        consumer2.reactor<GuestStayEvent>({
          processorId,
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
          await consumer1.stop();
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
        await pool.withConnection((connection) =>
          crashedInstanceLock.tryAcquire({ execute: connection.execute }),
        );
        await storeProcessorCheckpoint(pool.execute, {
          processorId,
          version: 1,
          newCheckpoint: firstPosition,
          lastProcessedCheckpoint: 0n,
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
