import { sqlite3Pool } from '@event-driven-io/dumbo/sqlite3';
import {
  getSQLiteEventStore,
  sqliteEventStoreConsumer,
} from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { describe } from 'vitest';
import {
  testReactorRecordsFailureAsEvent,
  testReactorSkipsAndStops,
  type ConsumerFactory,
  type ReactorConsumer,
} from './reactorErrors.features';

const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));

const sqliteConsumerFactory: ConsumerFactory = () => {
  const fileName = path.resolve(testDatabasePath, `reactorErrors-${uuid()}.db`);

  // the consumer and the event store share a pool, so a reactor appending to
  // the store does not deadlock against the connection pulling its messages
  const pool = sqlite3Pool({
    fileName,
    transactionOptions: { allowNestedTransactions: true },
  });

  const eventStore = getSQLiteEventStore({
    driver: sqlite3EventStoreDriver,
    fileName,
    pool,
  });

  const consumer = sqliteEventStoreConsumer({
    driver: sqlite3EventStoreDriver,
    fileName,
    pool,
  }) as unknown as ReactorConsumer;

  return Promise.resolve({
    eventStore,
    consumer,
    teardown: async () => {
      await eventStore.close();
      await pool.close();
      for (const suffix of ['', '-shm', '-wal']) {
        const file = `${fileName}${suffix}`;
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    },
  });
};

void describe('SQLite consumer', () => {
  testReactorRecordsFailureAsEvent(sqliteConsumerFactory);
  testReactorSkipsAndStops(sqliteConsumerFactory);
});
