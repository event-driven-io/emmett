import type { D1Database } from '@cloudflare/workers-types';
import {
  d1DumboDriver,
  type D1PoolOptions,
  type D1TransactionOptions,
} from '@event-driven-io/dumbo/cloudflare';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';
import { withNestedTransactionOptions } from './eventStore/transactionOptions';

export const d1EventStoreDriver: EventStoreDriver<
  typeof d1DumboDriver,
  D1EventStoreDriverOptions
> = {
  driverType: d1DumboDriver.driverType,
  dumboDriver: d1DumboDriver,
  mapToDumboOptions: (driverOptions) => {
    const connectionOptions = withNestedTransactionOptions<
      NonNullable<D1EventStoreDriverOptions['connectionOptions']>,
      D1TransactionOptions
    >(driverOptions.connectionOptions, { mode: 'session_based' });

    return {
      driver: d1DumboDriver,
      database: driverOptions.database,
      ...connectionOptions,
    } as D1PoolOptions;
  },
};

export type D1EventStoreDriver = typeof d1EventStoreDriver;

export type D1EventStoreDriverOptions = {
  database: D1Database;
  connectionOptions?: Omit<D1PoolOptions, 'database'>;
};

export type D1EventStoreOptions = SQLiteEventStoreOptions<D1EventStoreDriver>;
