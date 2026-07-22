import { dumbo, type Dumbo, SQL } from '@event-driven-io/dumbo';
import { assertEqual, type Event } from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../postgreSQLEventStore';
import { postgreSQLEventStoreConsumer } from './postgreSQLEventStoreConsumer';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL processor transaction handling', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let eventStore: PostgresEventStore;
  let observerPool: Dumbo;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
    eventStore = getPostgreSQLEventStore(connectionString);
    await eventStore.schema.migrate();
    observerPool = dumbo({ connectionString });
  }, 120000);

  beforeEach(async () => {
    await eventStore.schema.dangerous.truncate({
      resetSequences: true,
      truncateProjections: true,
    });
  });

  afterAll(async () => {
    try {
      await observerPool?.close();
      await eventStore?.close();
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it(
    'keeps messages appended through the handler context uncommitted until the processing transaction commits',
    withDeadline,
    async () => {
      // Given
      const guestId = uuid();
      const reactionStream = `reaction-${guestId}`;
      const appendResult = await eventStore.appendToStream(
        `guestStay-${guestId}`,
        [{ type: 'GuestCheckedIn', data: { guestId } }],
      );

      const visibleToOtherConnectionsDuringHandling: number[] = [];

      // When
      const consumer = postgreSQLEventStoreConsumer({ connectionString });
      consumer.reactor<GuestStayEvent>({
        processorId: uuid(),
        stopAfter: (event) =>
          event.metadata.globalPosition ===
          appendResult.lastEventGlobalPosition,
        eachMessage: async (event, context) => {
          await context.connection.messageStore.appendToStream(reactionStream, [
            { type: 'GuestCheckedOut', data: { guestId: event.data.guestId } },
          ]);

          const seen = await observerPool.execute.query<{ count: number }>(
            SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
          );
          visibleToOtherConnectionsDuringHandling.push(seen.rows[0]!.count);
        },
      });

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      // Then
      assertEqual(1, visibleToOtherConnectionsDuringHandling.length);
      assertEqual(0, visibleToOtherConnectionsDuringHandling[0]);

      const committed = await observerPool.execute.query<{ count: number }>(
        SQL`SELECT COUNT(*)::int AS count FROM emt_messages WHERE stream_id = ${reactionStream}`,
      );
      assertEqual(1, committed.rows[0]!.count);
    },
  );
});

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;
type GuestCheckedOut = Event<'GuestCheckedOut', { guestId: string }>;

type GuestStayEvent = GuestCheckedIn | GuestCheckedOut;
