import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { describe } from 'vitest';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import {
  testAppendToStream,
  testCommandHandling,
  type EventStoreFactory,
} from '../features';

const testDatabasePath = path.dirname(fileURLToPath(import.meta.url));

describe('SQLiteEventStore', () => {
  const fileName = path.resolve(testDatabasePath, `eventStore-${uuid()}.db`);
  let eventStore: SQLiteEventStore;

  const eventStoreFactory: EventStoreFactory = () => {
    eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
    });
    return Promise.resolve(eventStore);
  };

  const teardownHook = async () => {
    await eventStore.close();
    deleteSQLiteDatabaseFiles(fileName);
  };

  testAppendToStream(eventStoreFactory, { teardownHook });

  testCommandHandling(eventStoreFactory, {
    getInitialIndex: () => 1n,
    teardownHook,
  });
});
