/* eslint-disable @typescript-eslint/no-unsafe-call */
import { shoppingCartApi } from './simpleApi';

// #region getting-started-webApi-startApi
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';

const eventStore = getInMemoryEventStore();

const application = getApplication({ apis: [shoppingCartApi(eventStore)] });

const server = startAPI(application);
// #endregion getting-started-webApi-startApi

server.close();
