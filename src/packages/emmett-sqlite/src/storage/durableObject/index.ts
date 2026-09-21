import type { DurableObjectStorage } from '@cloudflare/workers-types';
import {
  cloudflareDurableObjectSQLiteDumboDriver,
  type CloudflareDurableObjectSQLiteDumboOptions,
} from '@event-driven-io/dumbo/cloudflare';
import { cloudflareDurableObjectSQLiteDriver } from '@event-driven-io/pongo/cloudflare';
import type { SQLiteEventStoreOptions } from '../../eventStore';
import type { EventStoreDriver } from '../../eventStore/eventStoreDriver';

export const durableObjectEventStoreDriver = {
  driverType: cloudflareDurableObjectSQLiteDumboDriver.driverType,
  dumboDriver: cloudflareDurableObjectSQLiteDumboDriver,
  pongoDriver: cloudflareDurableObjectSQLiteDriver,
  mapToDumboOptions: (options) => ({
    driver: cloudflareDurableObjectSQLiteDumboDriver,
    storage: options.storage,
    ...options.connectionOptions,
    transactionOptions: {
      allowNestedTransactions: true,
      ...options.connectionOptions?.transactionOptions,
    },
  }),
} satisfies EventStoreDriver<
  typeof cloudflareDurableObjectSQLiteDumboDriver,
  DurableObjectEventStoreDriverOptions
>;

export type DurableObjectEventStoreDriver =
  typeof durableObjectEventStoreDriver;

export type DurableObjectEventStoreDriverOptions = {
  storage: DurableObjectStorage;
  connectionOptions?: Omit<
    CloudflareDurableObjectSQLiteDumboOptions,
    'storage' | 'client' | 'connection'
  >;
};

export type DurableObjectEventStoreOptions =
  SQLiteEventStoreOptions<DurableObjectEventStoreDriver>;
