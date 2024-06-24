import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { EventStoreDBClient } from '@eventstore/db-client';
import type { Application } from 'express';
import { shoppingCartApi } from './shoppingCarts/api';
import type { ShoppingCartConfirmed } from './shoppingCarts/shoppingCart';

const eventStoreDBClient = EventStoreDBClient.connectionString(
  process.env.ESDB_CONNECTION_STRING ?? `esdb://localhost:2113?tls=false`,
);
const eventStore = getEventStoreDBEventStore(eventStoreDBClient);
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
