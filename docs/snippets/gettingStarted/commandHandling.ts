import { v4 as uuid } from 'uuid';
import { addProductItem } from './businessLogic';
import type { AddProductItemToShoppingCart } from './commands';
import type { PricedProductItem } from './events';
import { handle } from './webApi/simpleApi';

const shoppingCartId = uuid();
const productItem: PricedProductItem = {
  productId: uuid(),
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

console.log(nextExpectedStreamVersion);
