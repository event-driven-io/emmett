import { EventStore } from 'src/eventStore';

export type SQLiteEventStoreOptions = {
  type: 'sqlite';
  connectionString: string;
};

export const getSQLiteEventStore = (
  _options: SQLiteEventStoreOptions
): EventStore => {
  return {
    init: () => {
      return Promise.resolve();
    },
  };
};
