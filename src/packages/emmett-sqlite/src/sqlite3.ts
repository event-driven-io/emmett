import type {
  SQLite3DumboOptions,
  SQLiteTransactionOptions,
} from '@event-driven-io/dumbo/sqlite3';
import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';
import type { SQLiteEventStoreOptions } from './eventStore';
import type { EventStoreDriver } from './eventStore/eventStoreDriver';
import { withNestedTransactionOptions } from './eventStore/transactionOptions';

export const sqlite3EventStoreDriver: EventStoreDriver<
  typeof sqlite3DumboDriver,
  SQLite3EventStoreDriverOptions
> = {
  driverType: sqlite3DumboDriver.driverType,
  dumboDriver: sqlite3DumboDriver,
  mapToDumboOptions: (driverOptions) => {
    const connectionOptions = withNestedTransactionOptions<
      NonNullable<SQLite3EventStoreDriverOptions['connectionOptions']>,
      SQLiteTransactionOptions
    >(driverOptions.connectionOptions);

    return {
      driver: sqlite3DumboDriver,
      fileName: driverOptions.fileName,
      ...connectionOptions,
    } as SQLite3DumboOptions;
  },
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
