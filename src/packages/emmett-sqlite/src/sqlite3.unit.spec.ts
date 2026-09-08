import type { SQLite3DumboOptions } from '@event-driven-io/dumbo/sqlite3';
import { sqlite3DumboDriver } from '@event-driven-io/dumbo/sqlite3';
import { assertEqual } from '@event-driven-io/emmett';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import { describe, it } from 'vitest';
import {
  sqlite3EventStoreDriver,
  type SQLite3EventStoreDriverOptions,
} from './sqlite3';

const fileName = ':memory:';

/**
 * `SQLite3DumboOptions` has no `driver` key of its own, so the mapped options
 * declare it only through the cast inside {@link sqlite3EventStoreDriver}.
 * Reading it back needs the same widening.
 */
const driverOf = (options: SQLite3DumboOptions): unknown =>
  (options as { driver?: unknown }).driver;

void describe('sqlite3EventStoreDriver', () => {
  void it('names the same driver type as the dumbo driver it wraps', () => {
    assertEqual(
      sqlite3DumboDriver.driverType,
      sqlite3EventStoreDriver.driverType,
    );
    assertEqual(sqlite3DumboDriver, sqlite3EventStoreDriver.dumboDriver);
  });

  void it('carries the Pongo driver its projections need', () => {
    assertEqual<unknown>(
      sqlite3PongoDriver,
      sqlite3EventStoreDriver.pongoDriver,
    );
  });

  void it('carries the driver when given a file name alone', () => {
    const options = sqlite3EventStoreDriver.mapToDumboOptions({ fileName });

    assertEqual(sqlite3DumboDriver, driverOf(options));
    assertEqual(fileName, options.fileName);
  });

  void it('carries the driver for every supported option shape', () => {
    const shapes: SQLite3EventStoreDriverOptions[] = [
      { fileName },
      { fileName, connectionOptions: undefined },
      {
        fileName,
        connectionOptions: {
          transactionOptions: { allowNestedTransactions: false },
        },
      },
    ];

    for (const shape of shapes) {
      const options = sqlite3EventStoreDriver.mapToDumboOptions(shape);

      assertEqual(sqlite3DumboDriver, driverOf(options));
      assertEqual(fileName, options.fileName);
    }
  });

  void it('allows nested transactions unless the caller says otherwise', () => {
    assertEqual(
      true,
      sqlite3EventStoreDriver.mapToDumboOptions({ fileName }).transactionOptions
        ?.allowNestedTransactions,
    );
  });

  void it('keeps the transaction options the caller set explicitly', () => {
    const { transactionOptions } = sqlite3EventStoreDriver.mapToDumboOptions({
      fileName,
      connectionOptions: {
        transactionOptions: { allowNestedTransactions: false },
      },
    });

    assertEqual(false, transactionOptions?.allowNestedTransactions);
  });
});
