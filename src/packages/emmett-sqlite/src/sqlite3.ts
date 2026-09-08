import type { SQLite3DumboOptions } from '@event-driven-io/dumbo/sqlite3';
import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';

export const sqlite3EventStoreDriver = {
  driverType: sqlite3DumboDriver.driverType,
  dumboDriver: sqlite3DumboDriver,
  pongoDriver: sqlite3PongoDriver,
  mapToDumboOptions: (options) =>
    ({
      driver: sqlite3DumboDriver,
      fileName: options.fileName,
      ...options.connectionOptions,
      transactionOptions: {
        allowNestedTransactions: true,
        ...options.connectionOptions?.transactionOptions,
      },
    }) as SQLite3DumboOptions,
} satisfies EventStoreDriver<
  typeof sqlite3DumboDriver,
  SQLite3EventStoreDriverOptions
>;

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
