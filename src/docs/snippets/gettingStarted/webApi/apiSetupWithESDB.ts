/* eslint-disable @typescript-eslint/no-unused-vars */
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

// #region getting-started-api-setup
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { EventStoreDBClient } from '@eventstore/db-client';

const eventStoreDBClient = EventStoreDBClient.connectionString(
  `esdb://localhost:2113?tls=false`,
);
const eventStore = getEventStoreDBEventStore(eventStoreDBClient);

const shoppingCarts = shoppingCartApi(
  eventStore,
  getUnitPrice,
  () => new Date(),
);
// #endregion getting-started-api-setup
