import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver } from '@event-driven-io/dumbo/pg';
import {
  assertEqual,
  assertIsNotNull,
  assertTrue,
} from '@event-driven-io/emmett';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { getPostgreSQLEventStore, type PostgresEventStore } from '.';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import type {
  PricedProductItem,
  ShoppingCartEvent,
} from '../testing/shoppingCart.domain';

/**
 * Every other spec passes an options object carrying a driver. This one keeps
 * the deprecated `getPostgreSQLEventStore(connectionString, options)` form
 * covered until it is removed in the next major.
 */
void describe('Postgres event store built through the deprecated positional form', () => {
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
  };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
  });

  afterAll(async () => {
    await database?.close();
  });

  void it('builds its own pool from a connection string alone', async () => {
    const eventStore = getPostgreSQLEventStore(connectionString);

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('honours store options passed as the second argument', async () => {
    const eventStore = getPostgreSQLEventStore(connectionString, {
      schema: { autoMigration: 'None' },
    });

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('takes a native pg pool through the deprecated connectionOptions', async () => {
    const nativePool = new pg.Pool({ connectionString });

    const eventStore = getPostgreSQLEventStore(connectionString, {
      schema: { autoMigration: 'None' },
      connectionOptions: {
        connectionString,
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

  void it('takes a Dumbo instance through the deprecated connectionOptions', async () => {
    const eventStore = getPostgreSQLEventStore(connectionString, {
      schema: { autoMigration: 'None' },
      connectionOptions: {
        dumbo: dumbo({
          driver: pgDumboDriver,
          connectionString,
          transactionOptions: { allowNestedTransactions: true },
        }),
      },
    });

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('reaches the connection string through the handler context', async () => {
    let seenConnectionString: string | null = null;

    const eventStore = getPostgreSQLEventStore(connectionString, {
      schema: { autoMigration: 'CreateOrUpdate' },
      hooks: {
        onAfterSchemaCreated: (context) => {
          seenConnectionString =
            context.session.connectionOptions?.connectionString ?? null;
        },
      },
    });

    try {
      await eventStore.schema.migrate();

      assertIsNotNull(seenConnectionString);
      assertEqual(connectionString, seenConnectionString);
    } finally {
      await eventStore.close();
    }
  });
});
