import { InMemorySQLiteDatabase } from '@event-driven-io/dumbo/sqlite3';
import {
  getSQLiteEventStore,
  type SQLiteEventStore,
} from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { afterAll, describe } from 'vitest';
import {
  testAggregateStream,
  testListStreams,
  testReadStreamRanges,
  testStreamExists,
  type EventStoreFactory,
} from '../features';

describe('SQLiteEventStore', () => {
  let eventStore: SQLiteEventStore | undefined;

  const eventStoreFactory: EventStoreFactory = () => {
    eventStore ??= getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      schema: { autoMigration: 'CreateOrUpdate' },
      fileName: InMemorySQLiteDatabase,
    });
    return Promise.resolve(eventStore);
  };

  afterAll(() => eventStore?.close());

  testAggregateStream(eventStoreFactory);

  testStreamExists(eventStoreFactory);

  testReadStreamRanges(eventStoreFactory);

  testListStreams(eventStoreFactory);
});
