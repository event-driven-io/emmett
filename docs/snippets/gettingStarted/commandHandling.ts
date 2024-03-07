/* eslint-disable @typescript-eslint/no-unused-vars */
import { randomUUID } from 'node:crypto';
import { addProductItem } from './businessLogic';
import type { AddProductItemToShoppingCart } from './commands';
import type { PricedProductItem } from './events';
import { handle } from './webApi/simpleApi';

const shoppingCartId = randomUUID();
const productItem: PricedProductItem = {
  productId: randomUUID(),
  quantity: 1,
  unitPrice: 100,
};

// #region command-handling

import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();

const command: AddProductItemToShoppingCart = {
  type: 'AddProductItemToShoppingCart',
  data: {
    shoppingCartId,
    productItem,
  },
};

const { nextExpectedStreamVersion } = await handle(
  eventStore,
  shoppingCartId,
  (state) => addProductItem(command, state),
);

// #endregion command-handling
