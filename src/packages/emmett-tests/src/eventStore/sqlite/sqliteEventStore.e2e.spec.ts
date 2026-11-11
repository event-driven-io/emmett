import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { describe, expect } from 'vitest';
import { deleteSQLiteDatabaseFiles } from '../../testing/sqliteTestDatabase';
import {
  testAppendToStream,
  testCommandHandling,
  testConsumerSchemaVersion,
  testSchemaVersion,
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

  const storeMetadata = {
    correlationId: expect.any(String) as unknown,
    causationId: expect.any(String) as unknown,
    traceId: expect.any(String) as unknown,
    spanId: expect.any(String) as unknown,
    checkpoint: expect.any(String) as unknown,
    globalPosition: expect.any(String) as unknown,
  };

  testSchemaVersion(eventStoreFactory, {
    getInitialIndex: () => 1n,
    storeMetadata,
    teardownHook,
  });

  testConsumerSchemaVersion(eventStoreFactory, {
    getInitialIndex: () => 1n,
    storeMetadata,
    teardownHook,
  });
});
