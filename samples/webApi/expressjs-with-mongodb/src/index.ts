import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getMongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import type { Application } from 'express';
import shoppingCarts, { type ShoppingCartConfirmed } from './shoppingCarts';

const connectionString =
  process.env.MONGODB_CONNECTION_STRING ?? 'mongodb://localhost:27017/';

const eventStore = getMongoDBEventStore({
  connectionString,
  projections: projections.inline(shoppingCarts.projections),
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
