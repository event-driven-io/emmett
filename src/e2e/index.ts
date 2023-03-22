import { getEventStore, EventStore } from '../';

export const testEventStores: EventStore[] = [
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
