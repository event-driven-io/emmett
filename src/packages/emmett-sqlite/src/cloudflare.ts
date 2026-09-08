import type { D1Database } from '@cloudflare/workers-types';
import {
  d1DumboDriver,
  type D1PoolOptions,
} from '@event-driven-io/dumbo/cloudflare';
import { pongoDriver as d1PongoDriver } from '@event-driven-io/pongo/cloudflare';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';

export const d1EventStoreDriver = {
  driverType: d1DumboDriver.driverType,
  dumboDriver: d1DumboDriver,
  pongoDriver: d1PongoDriver,
  mapToDumboOptions: (options) => ({
    driver: d1DumboDriver,
    database: options.database,
    ...options.connectionOptions,
    transactionOptions: {
      allowNestedTransactions: true,
      mode: 'session_based',
      ...options.connectionOptions?.transactionOptions,
    },
  }),
} satisfies EventStoreDriver<typeof d1DumboDriver, D1EventStoreDriverOptions>;

export type D1EventStoreDriver = typeof d1EventStoreDriver;

export type D1EventStoreDriverOptions = {
  database: D1Database;
  connectionOptions?: Omit<D1PoolOptions, 'database'>;
};

export type D1EventStoreOptions = SQLiteEventStoreOptions<D1EventStoreDriver>;
