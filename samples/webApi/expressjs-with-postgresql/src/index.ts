import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import type { Application } from 'express';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';

const connectionString =
  'postgresql://dbuser:secretpassword@database.server.com:3211/mydb';

const eventStore = getPostgreSQLEventStore(connectionString, {
  projections: [...shoppingCarts.projections],
});

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
      inMemoryMessageBus,
      getUnitPrice,
      () => new Date(),
    ),
  ],
});

startAPI(application);
