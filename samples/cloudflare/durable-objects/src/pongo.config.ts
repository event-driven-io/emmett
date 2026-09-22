import { pongoSchema } from '@event-driven-io/pongo';
import type {
  ClientShoppingCarts,
  ShoppingCart,
} from './shoppingCarts/shoppingCart';

export const shoppingCarts = pongoSchema.collection<ShoppingCart>(
  'shoppingCarts',
  {
    indexes: {
      currentByClient: pongoSchema.index('shopping_carts_client_status', [
        'clientId',
        'status',
      ]),
    },
  },
);

export const clientShoppingCarts = pongoSchema.collection<ClientShoppingCarts>(
  'clientShoppingCarts',
);

export default {
  schema: pongoSchema.client({
    database: pongoSchema.db({
      collections: { shoppingCarts, clientShoppingCarts },
    }),
  }),
};
