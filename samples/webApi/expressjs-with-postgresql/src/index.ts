import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import { pongoClient } from '@event-driven-io/pongo';
import type { Application } from 'express';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';

const connectionString =
  process.env.POSTGRESQL_CONNECTION_STRING ??
  'postgresql://postgres:postgres@localhost:5432/postgres';

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: projections.inline(shoppingCarts.projections),
});

const readStore = pongoClient(connectionString);

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
      readStore.db(),
      inMemoryMessageBus,
      getUnitPrice,
      () => new Date(),
    ),
  ],
});

startAPI(application);
