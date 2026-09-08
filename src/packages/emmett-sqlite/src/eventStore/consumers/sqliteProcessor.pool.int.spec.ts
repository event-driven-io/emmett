import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';
import {
  assertEqual,
  assertFalse,
  assertTrue,
  type Event,
} from '@event-driven-io/emmett';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreDriver,
} from '../../sqlite3';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '../SQLiteEventStore';
import { sqliteEventStoreConsumer } from './sqliteEventStoreConsumer';

const withDeadline = { timeout: 30000 };

type GuestCheckedIn = Event<'GuestCheckedIn', { guestId: string }>;

void describe('SQLite processor pool', () => {
  const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));
  const fileName = path.resolve(testDatabasePath, 'processorPool.test.db');
  const otherFileName = path.resolve(
    testDatabasePath,
    'processorPool.other.test.db',
  );

  let eventStore: SQLiteEventStore;
  let otherEventStore: SQLiteEventStore;

  beforeEach(async () => {
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    await eventStore.schema.migrate();

    otherEventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName: otherFileName,
    });
    await otherEventStore.schema.migrate();
  });

  afterEach(async () => {
    await eventStore.close();
    await otherEventStore.close();
    deleteSQLiteDatabaseFiles(fileName);
    deleteSQLiteDatabaseFiles(otherFileName);
  });

  const poolSeenBy = async (
    processorFileName?: string,
  ): Promise<{
    consumerPool: Dumbo;
    seenPool: Dumbo | undefined;
    handled: number;
  }> => {
    const consumerPool = dumbo({
      driver: sqlite3DumboDriver,
      fileName,
      transactionOptions: { allowNestedTransactions: true },
    });

    let seenPool: Dumbo | undefined;
    let handled = 0;

    const consumer = sqliteEventStoreConsumer<
      GuestCheckedIn,
      SQLite3EventStoreDriver
    >({
      driver: sqlite3EventStoreDriver,
      pool: consumerPool,
      stopWhen: { noMessagesLeft: true },
    });

    consumer.reactor<GuestCheckedIn>({
      processorId: uuid(),
      startFrom: 'BEGINNING',
      canHandle: ['GuestCheckedIn'],
      connectionOptions: processorFileName
        ? { fileName: processorFileName }
        : undefined,
      eachMessage: (_message, context) => {
        seenPool = context.session.pool;
        handled++;
      },
    });

    await eventStore.appendToStream(`guestStay-${uuid()}`, [
      { type: 'GuestCheckedIn', data: { guestId: uuid() } },
    ]);

    try {
      await consumer.start();
    } finally {
      await consumer.close();
      await consumerPool.close();
    }

    return { consumerPool, seenPool, handled };
  };

  void it(
    'uses the consumer pool when the processor has no connection options',
    withDeadline,
    async () => {
      const { consumerPool, seenPool, handled } = await poolSeenBy();

      assertEqual(handled, 1);
      assertTrue(seenPool === consumerPool);
    },
  );

  void it(
    'opens its own pool when the processor has connection options',
    withDeadline,
    async () => {
      const { consumerPool, seenPool, handled } =
        await poolSeenBy(otherFileName);

      assertEqual(handled, 1);
      assertTrue(seenPool !== undefined);
      assertFalse(seenPool === consumerPool);
    },
  );

  void it(
    'handles messages on a file based database without pinning a connection',
    withDeadline,
    async () => {
      const guestIds = [uuid(), uuid(), uuid()];
      const handled: string[] = [];

      const consumer = sqliteEventStoreConsumer<
        GuestCheckedIn,
        SQLite3EventStoreDriver
      >({
        driver: sqlite3EventStoreDriver,
        fileName,
        stopWhen: { noMessagesLeft: true },
      });

      consumer.reactor<GuestCheckedIn>({
        processorId: uuid(),
        startFrom: 'BEGINNING',
        canHandle: ['GuestCheckedIn'],
        eachMessage: (message) => {
          handled.push(message.data.guestId);
        },
      });

      for (const guestId of guestIds)
        await eventStore.appendToStream(`guestStay-${guestId}`, [
          { type: 'GuestCheckedIn', data: { guestId } },
        ]);

      try {
        await consumer.start();
      } finally {
        await consumer.close();
      }

      assertEqual(handled.length, guestIds.length);
    },
  );
});
