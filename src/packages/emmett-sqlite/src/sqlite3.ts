import type { SQLite3DumboOptions } from '@event-driven-io/dumbo/sqlite3';
import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';

export const sqlite3EventStoreDriver: EventStoreDriver<
  typeof sqlite3DumboDriver,
  SQLite3EventStoreDriverOptions
> = {
  driverType: sqlite3DumboDriver.driverType,
  dumboDriver: sqlite3DumboDriver,
  mapToDumboOptions: (driverOptions) =>
    ({
      driver: sqlite3DumboDriver,
      fileName: driverOptions.fileName,
      ...driverOptions.connectionOptions,
      transactionOptions: {
        allowNestedTransactions: true,
      },
    }) as SQLite3DumboOptions,
};

export type SQLite3EventStoreDriver = typeof sqlite3EventStoreDriver;

export type SQLite3EventStoreDriverOptions = {
  fileName: string;
  connectionOptions?: Omit<
    SQLite3DumboOptions,
    'fileName' | 'connectionString'
  >;
};

export type SQLite3EventStoreOptions =
  SQLiteEventStoreOptions<SQLite3EventStoreDriver>;
