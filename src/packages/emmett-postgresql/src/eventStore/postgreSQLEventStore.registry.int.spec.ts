import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import { assertEqual, assertTrue } from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { getPostgreSQLEventStore, type PostgresEventStore } from '.';
import { pgEventStoreDriver } from '../pg';
import { clearRegisteredDumboDrivers } from '../testing/dumboDriverIsolation';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import type {
  PricedProductItem,
  ShoppingCartEvent,
} from '../testing/shoppingCart.domain';

void describe('Postgres event store without registered dumbo drivers', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let restoreDumboDrivers: () => void;

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

    restoreDumboDrivers = clearRegisteredDumboDrivers();
  });

  afterAll(async () => {
    restoreDumboDrivers?.();
    await database?.close();
  });

  void it('builds its own pool from a connection string alone', async () => {
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

  void it('opens no pool of its own when handed a Dumbo instance', async () => {
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

  void it('connects from driver options alone, with no top-level connection string', async () => {
    const eventStore = getPostgreSQLEventStore({
      driver: pgEventStoreDriver,
      schema: { autoMigration: 'None' },
      connectionOptions: { connectionString },
    });

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('opens no pool of its own when handed a native pg pool', async () => {
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
