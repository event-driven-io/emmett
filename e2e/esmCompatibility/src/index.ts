import { CommandHandler, getInMemoryEventStore } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import {
  type AddProductItemToShoppingCart,
  addProductItem,
} from './shoppingCart/businessLogic';
import { evolve, getInitialState } from './shoppingCart/shoppingCart';

export const handle = CommandHandler(evolve, getInitialState);
const store = getInMemoryEventStore();

const shoppingCartId = '123';
const command: AddProductItemToShoppingCart = {
  type: 'AddProductItemToShoppingCart',
  data: {
    productItem: { productId: randomUUID(), quantity: 10, unitPrice: 10 },
    shoppingCartId,
  },
};
const x = await handle(store, shoppingCartId, (state) =>
  addProductItem(command, state),
);
console.log(x);
