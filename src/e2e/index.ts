import { getEventStore, EventStore } from '../';

export const getTestEventStores = (): EventStore[] => {
  return [
    getEventStore({ type: 'inmemory' }),
    getEventStore({ type: 'sqlite', fileName: ':memory:' }),
    getEventStore({
      type: 'postgres',
      poolConfig: {
        host: 'localhost',
        user: 'postgres',
        password: 'Password12!',
      },
    }),
  ];
};
