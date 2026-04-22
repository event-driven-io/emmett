import { sqlite3Pool } from '@event-driven-io/dumbo/sqlite3';
import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import type { Application } from 'express';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';

const fileName = process.env.SQLITE_FILENAME ?? 'file:./emmett_event_store.db';

const pool = sqlite3Pool({ fileName });

const eventStore = getSQLiteEventStore({
  driver: sqlite3EventStoreDriver,
  fileName,
  projections: projections.inline(shoppingCarts.readModel.projections),
  pool,
});
await eventStore.schema.migrate();

const inMemoryMessageBus = getInMemoryMessageBus();

// dummy example to show subscription
inMemoryMessageBus.subscribe((event: ShoppingCartConfirmed) => {
  console.log('Shopping Cart confirmed: ' + JSON.stringify(event));
}, 'ShoppingCartConfirmed');

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const application: Application = getApplication({
  apis: [
    shoppingCarts.api(
      eventStore,
      pool,
      inMemoryMessageBus,
      getUnitPrice,
      () => new Date(),
    ),
  ],
});

startAPI(application);
