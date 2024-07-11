import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import type { Application } from 'express';
import { shoppingCartApi } from './shoppingCarts/api';
import type { ShoppingCartConfirmed } from './shoppingCarts/shoppingCart';

import {
  getPool,
  getPostgreSQLEventStore,
} from '@event-driven-io/emmett-postgresql';

const connectionString =
  'postgresql://dbuser:secretpassword@database.server.com:3211/mydb';

const pool = getPool(connectionString);
const eventStore = getPostgreSQLEventStore(pool);

const inMemoryMessageBus = getInMemoryMessageBus();

// dummy example to show subscription
inMemoryMessageBus.subscribe((event: ShoppingCartConfirmed) => {
  console.log('Shopping Cart confirmed: ' + JSON.stringify(event));
}, 'ShoppingCartConfirmed');

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const shoppingCarts = shoppingCartApi(
  eventStore,
  inMemoryMessageBus,
  getUnitPrice,
  () => new Date(),
);

const application: Application = getApplication({
  apis: [shoppingCarts],
});

startAPI(application);
