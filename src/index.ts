import { EventStore } from './eventStore';
import { getInMemoryEventStore, InMemoryEventStoreOptions } from './inmemory';
import { getPostgresEventStore, PostgresEventStoreOptions } from './postgres';
import { getSQLiteEventStore, SQLiteEventStoreOptions } from './sqlite';

export * from './eventStore';

export type EventStoreOptions =
  | PostgresEventStoreOptions
  | InMemoryEventStoreOptions
  | SQLiteEventStoreOptions;

export const getEventStore = (options: EventStoreOptions): EventStore => {
  switch (options.type) {
    case 'postgres':
      return getPostgresEventStore(options);
    case 'inmemory':
      return getInMemoryEventStore(options);
    case 'sqlite':
      return getSQLiteEventStore(options);
    default: {
      const _: never = options;
      throw new Error('Unsupported event store type');
    }
  }
};
