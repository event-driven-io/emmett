/* eslint-disable @typescript-eslint/no-unsafe-call */
import { shoppingCartApi } from './simpleApi';

// #region getting-started-webApi-startApi
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import type { Application } from 'express';
import type { Server } from 'http';

const eventStore = getInMemoryEventStore();

const shoppingCarts = shoppingCartApi(eventStore);

const application: Application = getApplication({
  apis: [shoppingCarts],
});

const server: Server = startAPI(application);
// #endregion getting-started-webApi-startApi

server.close();
