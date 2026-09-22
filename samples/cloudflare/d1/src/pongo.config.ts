import { pongoSchema } from '@event-driven-io/pongo';
import type {
  ClientShoppingCarts,
  ShoppingCart,
} from './shoppingCarts/projections';

export const shoppingCartsCollection = pongoSchema.collection<ShoppingCart>(
  'shoppingCarts',
  {
    indexes: {
      byClientAndStatus: pongoSchema.index('shopping_carts_by_client_status', [
        'clientId',
        'status',
      ]),
    },
  },
);

export const clientShoppingCartsCollection =
  pongoSchema.collection<ClientShoppingCarts>('clientShoppingCarts');

export default {
  schema: pongoSchema.client({
    database: pongoSchema.db({
      collections: {
        shoppingCarts: shoppingCartsCollection,
        clientShoppingCarts: clientShoppingCartsCollection,
      },
    }),
  }),
};
