import { assertEqual, assertTrue } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../sqlite3';
import { clearRegisteredDumboDrivers } from '../testing/dumboDriverIsolation';
import type {
  PricedProductItem,
  ShoppingCartEvent,
} from '../testing/shoppingCart.domain';
import { deleteSQLiteDatabaseFiles } from '../testing/sqliteTestDatabase';
import { getSQLiteEventStore, type SQLiteEventStore } from './SQLiteEventStore';

void describe('SQLite event store without registered dumbo drivers', () => {
  let fileName: string;
  let restoreDumboDrivers: () => void;

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  const migrateAppendAndRead = async (eventStore: SQLiteEventStore) => {
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

  beforeAll(() => {
    fileName = `./test-registry-${uuid()}.db`;
    restoreDumboDrivers = clearRegisteredDumboDrivers();
  });

  afterAll(() => {
    restoreDumboDrivers?.();
    deleteSQLiteDatabaseFiles(fileName);
  });

  void it('builds its own pool from the driver it was given', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: { autoMigration: 'None' },
    });

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });

  void it('connects from driver connection options alone', async () => {
    const eventStore = getSQLiteEventStore({
      driver: sqlite3EventStoreDriver,
      fileName,
      schema: { autoMigration: 'None' },
      connectionOptions: { singleton: true },
    });

    try {
      await migrateAppendAndRead(eventStore);
    } finally {
      await eventStore.close();
    }
  });
});
