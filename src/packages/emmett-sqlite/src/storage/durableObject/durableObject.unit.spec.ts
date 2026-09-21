import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { cloudflareDurableObjectSQLiteDumboDriver } from '@event-driven-io/dumbo/cloudflare';
import { assertEqual } from '@event-driven-io/emmett';
import { cloudflareDurableObjectSQLiteDriver } from '@event-driven-io/pongo/cloudflare';
import { describe, it } from 'vitest';
import { durableObjectEventStoreDriver } from '.';

const storage = {} as DurableObjectStorage;

void describe('durableObjectEventStoreDriver', () => {
  void it('names the same driver type as the dumbo driver it wraps', () => {
    assertEqual(
      cloudflareDurableObjectSQLiteDumboDriver.driverType,
      durableObjectEventStoreDriver.driverType,
    );
    assertEqual(
      cloudflareDurableObjectSQLiteDumboDriver,
      durableObjectEventStoreDriver.dumboDriver,
    );
  });

  void it('carries the Pongo driver its projections need', () => {
    assertEqual<unknown>(
      cloudflareDurableObjectSQLiteDriver,
      durableObjectEventStoreDriver.pongoDriver,
    );
  });

  void it('carries the driver and the storage it was given', () => {
    const options = durableObjectEventStoreDriver.mapToDumboOptions({
      storage,
    });

    assertEqual<unknown>(
      cloudflareDurableObjectSQLiteDumboDriver,
      (options as { driver?: unknown }).driver,
    );
    assertEqual(storage, options.storage);
  });

  void it('allows nested transactions by default', () => {
    const { transactionOptions } =
      durableObjectEventStoreDriver.mapToDumboOptions({ storage });

    assertEqual(true, transactionOptions?.allowNestedTransactions);
  });

  void it('keeps the transaction options the caller set explicitly', () => {
    const { transactionOptions } =
      durableObjectEventStoreDriver.mapToDumboOptions({
        storage,
        connectionOptions: {
          transactionOptions: { allowNestedTransactions: false },
        },
      });

    assertEqual(false, transactionOptions?.allowNestedTransactions);
  });
});
