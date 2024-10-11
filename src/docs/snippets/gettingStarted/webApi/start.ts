import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

// #region getting-started-webApi-startApi
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import type { Application } from 'express';
import type { Server } from 'http';

const eventStore = getInMemoryEventStore();

const shoppingCarts = shoppingCartApi(
  eventStore,
  getUnitPrice,
  () => new Date(),
);

const application: Application = getApplication({
  apis: [shoppingCarts],
});

const server: Server = startAPI(application);
// #endregion getting-started-webApi-startApi

server.close();
