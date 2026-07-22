import {
  assertRejects,
  assertThatArray,
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
import { PostgreSQLEventStoreCheckpoint } from '../schema';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';

type GuestStayEvent = Event<
  'GuestCheckedIn' | 'GuestCheckedOut',
  { guestId: string }
>;

const withDeadline = { timeout: 30000 };

void describe('waiting for a PostgreSQL consumer to catch up in a test', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
  });

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({
      resetSequences: true,
      truncateProjections: true,
    });
  });

  afterAll(async () => {
    try {
      await eventStore?.close();
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'lets a test append after start and assert once the consumer has caught up',
    withDeadline,
    async () => {
      // Given
      const processed: GuestStayEvent[] = [];
      const consumer = postgreSQLEventStoreConsumer({
        connectionString,
      });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        eachMessage: (event) => {
          processed.push(event);
        },
      });

      const guestId = uuid();
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];

      let consumerPromise: Promise<void> | undefined;
      try {
        // When
        consumerPromise = consumer.start();
        await consumer.whenStarted();

        await eventStore.appendToStream(`guestStay-${guestId}`, events);

        await consumer.whenCaughtUp();

        // Then
        assertThatArray(processed).containsElementsMatching(events);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );

  void it(
    'lets a test wait for a specific appended position',
    withDeadline,
    async () => {
      // Given
      const processed: GuestStayEvent[] = [];
      const consumer = postgreSQLEventStoreConsumer({
        connectionString,
      });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        eachMessage: (event) => {
          processed.push(event);
        },
      });

      const guestId = uuid();
      const events: GuestStayEvent[] = [
        { type: 'GuestCheckedIn', data: { guestId } },
        { type: 'GuestCheckedOut', data: { guestId } },
      ];

      let consumerPromise: Promise<void> | undefined;
      try {
        // When
        consumerPromise = consumer.start();
        await consumer.whenStarted();

        const appendResult = await eventStore.appendToStream(
          `guestStay-${guestId}`,
          events,
        );

        await consumer.whenProcessed(appendResult.lastEventGlobalPosition);

        // Then
        assertThatArray(processed).containsElementsMatching(events);
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );

  void it(
    'fails fast with a clear error instead of hanging when the point is never reached',
    withDeadline,
    async () => {
      // Given
      const consumer = postgreSQLEventStoreConsumer({
        connectionString,
      });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        eachMessage: () => {},
      });

      const guestId = uuid();
      await eventStore.appendToStream(`guestStay-${guestId}`, [
        { type: 'GuestCheckedIn', data: { guestId } },
      ]);

      let consumerPromise: Promise<void> | undefined;
      try {
        consumerPromise = consumer.start();
        await consumer.whenStarted();

        // When / Then - a position far past the tail is never reached
        await assertRejects(
          consumer.whenProcessed(
            PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint({
              transactionId: 99_999_999_999_999_999_999n,
              globalPosition: 9_999_999_999n,
            }),
            {
              timeout: 200,
            },
          ),
        );
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );
});
