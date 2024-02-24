/* eslint-disable @typescript-eslint/no-unused-vars */
import { shoppingCartApi } from './simpleApi';

// #region getting-started-api-setup
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const shoppingCarts = shoppingCartApi(eventStore);
// #endregion getting-started-api-setup
