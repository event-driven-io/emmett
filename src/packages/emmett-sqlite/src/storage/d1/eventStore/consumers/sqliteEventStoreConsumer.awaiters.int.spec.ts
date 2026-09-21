import {
  d1Pool,
  type D1ConnectionPool,
} from '@event-driven-io/dumbo/cloudflare';
import {
  assertRejects,
  assertThatArray,
  bigIntProcessorCheckpoint,
  type Event,
} from '@event-driven-io/emmett';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { d1EventStoreDriver } from '../..';
import { createEventStoreSchema } from '../../../../eventStore/schema';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../../../../eventStore/SQLiteEventStore';
import { sqliteEventStoreConsumer } from '../../../../eventStore/consumers/sqliteEventStoreConsumer';

type GuestStayEvent = Event<
  'GuestCheckedIn' | 'GuestCheckedOut',
  { guestId: string }
>;

const withDeadline = { timeout: 30000 };

void describe('waiting for a SQLite consumer to catch up in a test', () => {
  let mf: Miniflare;
  let database: D1Database;
  let pool: D1ConnectionPool;

  let eventStore: SQLiteEventStore;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    pool = d1Pool({
      database,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });
    eventStore = getSQLiteEventStore({
      driver: d1EventStoreDriver,
      schema: { autoMigration: 'None' },
      database,
      pool,
    });
    await createEventStoreSchema({
      pool: d1Pool({
        database,
        transactionOptions: {
          allowNestedTransactions: true,
          mode: 'session_based',
        },
      }),
    });
  });

  afterEach(async () => {
    await eventStore.close();
    await pool.close();
    await mf.dispose();
  });

  void it(
    'lets a test append after start and assert once the consumer has caught up',
    withDeadline,
    async () => {
      // Given
      const processed: GuestStayEvent[] = [];
      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
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
      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
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
      const consumer = sqliteEventStoreConsumer({
        driver: d1EventStoreDriver,
        database,
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

        // When
        await assertRejects(
          // When
          consumer.whenProcessed(bigIntProcessorCheckpoint(9_999_999_999n), {
            timeout: 200,
          }),
        );
      } finally {
        await consumer.close();
        await consumerPromise;
      }
    },
  );
});
