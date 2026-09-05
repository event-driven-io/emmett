import { dumbo, dumboDatabaseDriverRegistry } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertIsNotNull,
  assertThrows,
  assertTrue,
} from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { getPostgreSQLEventStore, type PostgresEventStore } from '.';
import { withoutRegisteredDumboDrivers } from '../testing/dumboDriverIsolation';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import type {
  PricedProductItem,
  ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import { pgEventStoreDriver } from '../pg';

/**
 * The override in {@link withoutRegisteredDumboDrivers} replaces lookups on the
 * process-wide dumbo driver registry, so this file keeps it to itself and runs
 * its tests one after another.
 */
void describe('Postgres event store without registered dumbo drivers', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  const migrateAppendAndRead = async (eventStore: PostgresEventStore) => {
    await eventStore.schema.migrate();

    const shoppingCartId = `shopping_cart-${uuid()}`;

    const appended = await eventStore.appendToStream<ShoppingCartEvent>(
      shoppingCartId,
      [
        { type: 'ProductItemAdded', data: { productItem } },
        { type: 'DiscountApplied', data: { percent: 10, couponId: uuid() } },
      ],
    );

    assertEqual(2n, appended.nextExpectedStreamVersion);
    assertEqual(true, appended.createdNewStream);

    const { events, currentStreamVersion, streamExists } =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertTrue(streamExists);
    assertEqual(2n, currentStreamVersion);
    assertEqual(2, events.length);
    assertEqual('ProductItemAdded', events[0]!.type);
    assertEqual('DiscountApplied', events[1]!.type);
  };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
  });

  afterAll(async () => {
    await database?.close();
  });

  void it('leaves the driver registry unable to resolve anything', async () => {
    await withoutRegisteredDumboDrivers(() => {
      assertEqual(
        null,
        dumboDatabaseDriverRegistry.tryGet({ connectionString }),
      );

      // the bare call is the assertion: it must not find a driver to fall back on
      // eslint-disable-next-line no-restricted-syntax
      const error = assertThrows<Error>(() => dumbo({ connectionString }));

      assertTrue(error.message.includes('No plugin found for driver type'));

      return Promise.resolve();
    });
  });

  void it('restores the driver registry once the callback returns', async () => {
    await withoutRegisteredDumboDrivers(() => Promise.resolve());

    assertIsNotNull(dumboDatabaseDriverRegistry.tryGet({ connectionString }));

    // the bare call is the assertion: the registry must resolve a driver again
    // eslint-disable-next-line no-restricted-syntax
    const pool = dumbo({ connectionString });
    await pool.close();
  });

  void it('builds its own pool from a connection string alone', async () => {
    await withoutRegisteredDumboDrivers(async () => {
      const eventStore = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None' },
      });

      try {
        await migrateAppendAndRead(eventStore);
      } finally {
        await eventStore.close();
      }
    });
  });

  void it('opens no pool of its own when handed a Dumbo instance', async () => {
    await withoutRegisteredDumboDrivers(async () => {
      const eventStore = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None' },
        pool: dumbo({
          driver: pgDumboDriver,
          connectionString,
          transactionOptions: { allowNestedTransactions: true },
        }),
      });

      try {
        await migrateAppendAndRead(eventStore);
      } finally {
        await eventStore.close();
      }
    });
  });

  void it('opens no pool of its own when handed a native pg pool', async () => {
    await withoutRegisteredDumboDrivers(async () => {
      const nativePool = new pg.Pool({ connectionString });

      const eventStore = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString: connectionString,
        schema: { autoMigration: 'None' },
        connectionOptions: {
          pooled: true,
          pool: nativePool,
        },
      });

      try {
        await migrateAppendAndRead(eventStore);
      } finally {
        await eventStore.close();
        await nativePool.end();
      }
    });
  });

  void it('takes its driver from an options object carrying one', async () => {
    const { pgEventStoreDriver } = await import('../pg');

    await withoutRegisteredDumboDrivers(async () => {
      const eventStore = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { autoMigration: 'None' },
      });

      try {
        await migrateAppendAndRead(eventStore);
      } finally {
        await eventStore.close();
      }
    });
  });
});
