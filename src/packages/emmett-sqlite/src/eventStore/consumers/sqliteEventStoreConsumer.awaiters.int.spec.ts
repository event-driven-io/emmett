import { JSONSerializer } from '@event-driven-io/dumbo';
import {
  sqlite3Connection,
  sqlite3Pool,
  type SQLite3Connection,
  type SQLitePool,
} from '@event-driven-io/dumbo/sqlite3';
import {
  assertThatArray,
  assertRejects,
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

type GuestStayEvent = Event<
  'GuestCheckedIn' | 'GuestCheckedOut',
  { guestId: string }
>;

const withDeadline = { timeout: 30000 };

void describe('waiting for a SQLite consumer to catch up in a test', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, `awaiters.test.db`);

  let pool: SQLitePool<SQLite3Connection>;

  const config: SQLite3EventStoreOptions = {
    driver: sqlite3EventStoreDriver,
    schema: { autoMigration: 'None' },
    fileName,
  };

  let eventStore: SQLiteEventStore;

  beforeEach(() => {
    pool = sqlite3Pool({
      fileName,
      transactionOptions: { allowNestedTransactions: true },
    });
    eventStore = getSQLiteEventStore({ ...config, pool });
    return createEventStoreSchema(
      sqlite3Connection({ fileName, serializer: JSONSerializer }),
    );
  });

  afterEach(async () => {
    await eventStore.close();
    await pool.close();
    if (!fs.existsSync(fileName)) return;
    try {
      fs.unlinkSync(fileName);
      fs.unlinkSync(`${fileName}-shm`);
      fs.unlinkSync(`${fileName}-wal`);
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
      const consumer = sqliteEventStoreConsumer({
        driver: sqlite3EventStoreDriver,
        fileName,
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
        driver: sqlite3EventStoreDriver,
        fileName,
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
        driver: sqlite3EventStoreDriver,
        fileName,
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
