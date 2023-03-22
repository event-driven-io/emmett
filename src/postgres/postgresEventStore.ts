import { EventStore } from 'src/eventStore';

export type PostgresEventStoreOptions = {
  type: 'postgres';
  connectionString: string;
};

export const getPostgresEventStore = (
  _options: PostgresEventStoreOptions
): EventStore => {
  return {
    init: () => {
      return Promise.resolve();
    },
  };
};
