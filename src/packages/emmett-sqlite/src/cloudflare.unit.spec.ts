import type { D1Database } from '@cloudflare/workers-types';
import { d1DumboDriver } from '@event-driven-io/dumbo/cloudflare';
import { assertEqual } from '@event-driven-io/emmett';
import { pongoDriver as d1PongoDriver } from '@event-driven-io/pongo/cloudflare';
import { describe, it } from 'vitest';
import { d1EventStoreDriver } from './cloudflare';

const database = {} as D1Database;

void describe('d1EventStoreDriver', () => {
  void it('names the same driver type as the dumbo driver it wraps', () => {
    assertEqual(d1DumboDriver.driverType, d1EventStoreDriver.driverType);
    assertEqual(d1DumboDriver, d1EventStoreDriver.dumboDriver);
  });

  void it('carries the Pongo driver its projections need', () => {
    assertEqual<unknown>(d1PongoDriver, d1EventStoreDriver.pongoDriver);
  });

  void it('carries the driver and the database it was given', () => {
    const options = d1EventStoreDriver.mapToDumboOptions({ database });

    assertEqual<unknown>(
      d1DumboDriver,
      (options as { driver?: unknown }).driver,
    );
    assertEqual(database, options.database);
  });

  void it('runs D1 transactions in session mode, nested calls allowed', () => {
    const { transactionOptions } = d1EventStoreDriver.mapToDumboOptions({
      database,
    });

    assertEqual(true, transactionOptions?.allowNestedTransactions);
    assertEqual('session_based', transactionOptions?.mode);
  });

  void it('keeps the transaction options the caller set explicitly', () => {
    const { transactionOptions } = d1EventStoreDriver.mapToDumboOptions({
      database,
      connectionOptions: {
        transactionOptions: { allowNestedTransactions: false, mode: 'strict' },
      },
    });

    assertEqual(false, transactionOptions?.allowNestedTransactions);
    assertEqual('strict', transactionOptions?.mode);
  });
});
