/* eslint-disable @typescript-eslint/no-unused-vars */
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

// #region getting-started-api-setup
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const shoppingCarts = shoppingCartApi(eventStore, getUnitPrice);
// #endregion getting-started-api-setup
