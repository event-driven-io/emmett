import {
  assertNotEmptyString,
  assertPositiveNumber,
  CommandHandler,
  type EventsPublisher,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  addProductItem,
  cancel,
  confirm,
  removeProductItem,
  type AddProductItemToShoppingCart,
  type CancelShoppingCart,
  type ConfirmShoppingCart,
  type RemoveProductItemFromShoppingCart,
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

export const removeProductItemFromCurrentShoppingCart = async (options: {
  eventStore: EventStore;
  getCurrentTime: () => Date;
  clientId?: string;
  productItem: {
    productId?: string;
    quantity?: number;
    unitPrice?: number;
  };
}): Promise<void> => {
  const {
    eventStore,
    getCurrentTime,
    clientId: clientIdFromRequest,
    productItem: productItemFromRequest,
  } = options;
  const clientId = assertNotEmptyString(clientIdFromRequest);
  const shoppingCartId = getShoppingCartId(clientId);
  const productItem = {
    productId: assertNotEmptyString(productItemFromRequest.productId),
    quantity: assertPositiveNumber(productItemFromRequest.quantity),
    unitPrice: assertPositiveNumber(productItemFromRequest.unitPrice),
  };

  const command: RemoveProductItemFromShoppingCart = {
    type: 'RemoveProductItemFromShoppingCart',
    data: { shoppingCartId, productItem },
    metadata: { clientId, now: getCurrentTime() },
  };

  await handleShoppingCartCommand(eventStore, shoppingCartId, (state) =>
    removeProductItem(command, state),
  );
};

export const confirmCurrentShoppingCart = async (options: {
  eventStore: EventStore;
  eventPublisher: EventsPublisher;
  getCurrentTime: () => Date;
  clientId?: string;
}): Promise<void> => {
  const {
    eventStore,
    eventPublisher,
    getCurrentTime,
    clientId: clientIdFromRequest,
  } = options;
  const clientId = assertNotEmptyString(clientIdFromRequest);
  const shoppingCartId = getShoppingCartId(clientId);

  const command: ConfirmShoppingCart = {
    type: 'ConfirmShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now: getCurrentTime() },
  };

  const {
    newEvents: [confirmed, ..._rest],
  } = await handleShoppingCartCommand(eventStore, shoppingCartId, (state) =>
    confirm(command, state),
  );

  // This is just an example, it'll run in-proc, so don't do that if you care
  // about delivery guarantees.
  await eventPublisher.publish(confirmed);
};

export const cancelCurrentShoppingCart = async (options: {
  eventStore: EventStore;
  getCurrentTime: () => Date;
  clientId?: string;
}): Promise<void> => {
  const { eventStore, getCurrentTime, clientId: clientIdFromRequest } = options;
  const clientId = assertNotEmptyString(clientIdFromRequest);
  const shoppingCartId = getShoppingCartId(clientId);

  const command: CancelShoppingCart = {
    type: 'CancelShoppingCart',
    data: { shoppingCartId },
    metadata: { clientId, now: getCurrentTime() },
  };

  await handleShoppingCartCommand(eventStore, shoppingCartId, (state) =>
    cancel(command, state),
  );
};
