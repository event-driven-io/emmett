import {
  assertNotEmptyString,
  assertPositiveNumber,
  CommandHandler,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  addProductItem,
  type AddProductItemToShoppingCart,
} from './businessLogic';
import { evolve, initialState } from './shoppingCart';

export const getShoppingCartId = (clientId: string) =>
  `shopping_cart:${assertNotEmptyString(clientId)}:current`;

export const handleShoppingCartCommand = CommandHandler({
  evolve,
  initialState,
});

export const addProductItemToCurrentShoppingCart = async (options: {
  eventStore: EventStore;
  getUnitPrice: (_productId: string) => Promise<number>;
  getCurrentTime: () => Date;
  clientId?: string;
  productId?: string;
  quantity?: number;
}): Promise<void> => {
  const {
    eventStore,
    getUnitPrice,
    getCurrentTime,
    clientId: clientIdFromRequest,
    productId: productIdFromRequest,
    quantity: quantityFromRequest,
  } = options;

  const clientId = assertNotEmptyString(clientIdFromRequest);
  const productId = assertNotEmptyString(productIdFromRequest);
  const quantity = assertPositiveNumber(quantityFromRequest);
  const shoppingCartId = getShoppingCartId(clientId);

  const command: AddProductItemToShoppingCart = {
    type: 'AddProductItemToShoppingCart',
    data: {
      shoppingCartId,
      clientId,
      productItem: {
        productId,
        quantity,
        unitPrice: await getUnitPrice(productId),
      },
    },
    metadata: { clientId, now: getCurrentTime() },
  };

  await handleShoppingCartCommand(eventStore, shoppingCartId, (state) =>
    addProductItem(command, state),
  );
};
