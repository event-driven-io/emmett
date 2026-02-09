import type { D1Database } from '@cloudflare/workers-types';
import {
  d1DumboDriver,
  type D1PoolOptions,
} from '@event-driven-io/dumbo/cloudflare';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';

export const d1EventStoreDriver: EventStoreDriver<
  typeof d1DumboDriver,
  D1EventStoreDriverOptions
> = {
  driverType: d1DumboDriver.driverType,
  dumboDriver: d1DumboDriver,
  mapToDumboOptions: (driverOptions) => ({
    driver: d1DumboDriver,
    database: driverOptions.database,
    ...driverOptions.connectionOptions,
    transactionOptions: {
      allowNestedTransactions: true,
      mode: 'session_based',
    },
  }),
};

export type D1EventStoreDriver = typeof d1EventStoreDriver;

export type D1EventStoreDriverOptions = {
  database: D1Database;
  connectionOptions?: Omit<D1PoolOptions, 'database'>;
};

export type D1EventStoreOptions = SQLiteEventStoreOptions<D1EventStoreDriver>;
