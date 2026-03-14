import { getInMemoryMessageBus } from '@event-driven-io/emmett';
import { getApplication, startAPI } from '@event-driven-io/emmett-expressjs';
import { getOpossumEventStore } from '@event-driven-io/emmett-opossum';
import type { Application } from 'express';
import { shoppingCartApi, type ShoppingCartConfirmed } from './shoppingCarts';

const storeName =
  process.env.OPOSSUM_STORE_NAME ?? 'emmett_shopping_carts';
const rootPath = process.env.OPOSSUM_ROOT_PATH;

const eventStore = await getOpossumEventStore({
  storeName,
  ...(rootPath !== undefined ? { rootPath } : {}),
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
    shoppingCartApi(
      eventStore,
      inMemoryMessageBus,
      getUnitPrice,
      () => new Date(),
    ),
  ],
});

startAPI(application);
