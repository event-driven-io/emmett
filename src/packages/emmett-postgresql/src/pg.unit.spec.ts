import type { PgPoolOptions } from '@event-driven-io/dumbo/pg';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import { assertEqual } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import { pgEventStoreDriver, type PgEventStoreDriverOptions } from './pg';

const connectionString = 'postgresql://user:pass@localhost:5432/emmett';

/**
 * `PgPoolOptions` has no `driver` key of its own, so the mapped options declare
 * it only through the cast inside {@link pgEventStoreDriver}. Reading it back
 * needs the same widening.
 */
const driverOf = (options: PgPoolOptions): unknown =>
  (options as { driver?: unknown }).driver;

void describe('pgEventStoreDriver', () => {
  void it('names the same driver type as the dumbo driver it wraps', () => {
    assertEqual(pgDumboDriver.driverType, pgEventStoreDriver.driverType);
    assertEqual(pgDumboDriver, pgEventStoreDriver.dumboDriver);
  });

  void it('carries the driver when given a connection string alone', () => {
    const options = pgEventStoreDriver.mapToDumboOptions({ connectionString });

    assertEqual(pgDumboDriver, driverOf(options));
    assertEqual(connectionString, options.connectionString);
  });

  void it('carries the driver alongside a database name', () => {
    const options = pgEventStoreDriver.mapToDumboOptions({
      connectionString,
      connectionOptions: { database: 'emmett_other' },
    });

    assertEqual(pgDumboDriver, driverOf(options));
    assertEqual(connectionString, options.connectionString);
    assertEqual('emmett_other', options.database);
  });

  void it('carries the driver for every supported option shape', () => {
    const shapes: PgEventStoreDriverOptions[] = [
      { connectionString },
      { connectionString, connectionOptions: undefined },
      { connectionString, connectionOptions: { database: 'emmett_other' } },
      {
        connectionString,
        connectionOptions: {
          transactionOptions: { allowNestedTransactions: false },
        },
      },
    ];

    for (const shape of shapes) {
      const options = pgEventStoreDriver.mapToDumboOptions(shape);

      assertEqual(pgDumboDriver, driverOf(options));
      assertEqual(connectionString, options.connectionString);
    }
  });

  void it('allows nested transactions unless the caller says otherwise', () => {
    assertEqual(
      true,
      pgEventStoreDriver.mapToDumboOptions({ connectionString })
        .transactionOptions?.allowNestedTransactions,
    );
  });
});
