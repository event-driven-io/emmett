import {
  assertNotEmptyString,
  DeciderCommandHandler,
  type EventStore,
  assertPositiveNumber,
} from '@event-driven-io/emmett';
import {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { decider } from './businessLogic';
import { type PricedProductItem, type ProductItem } from './shoppingCart';


export const handle = DeciderCommandHandler(decider);
const dummyPriceProvider = (_productId: string) => {
  return 100;
};

interface ShoppingCartItem {
  shoppingCartId: string;
}

export const RegisterRoutes = (eventStore: EventStore) => (app: FastifyInstance) => {
  app.post(
    '/clients/:clientId/shopping-carts',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { clientId } = request.params as { clientId: string };
      assertNotEmptyString(clientId);
      const shoppingCartId = clientId;
      await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'OpenShoppingCart',
          data: { clientId: shoppingCartId, shoppingCartId, now: new Date() },
        },
      );
      reply.code(201).send({ clientId });
    },
  );
  app.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { shoppingCartId } = request.params as ShoppingCartItem;
      assertNotEmptyString(shoppingCartId);
      const { productId, quantity } = request.body as PricedProductItem;
      const productItem: ProductItem = {
        productId: assertNotEmptyString(productId),
        quantity: assertPositiveNumber(quantity),
      };

      const unitPrice = dummyPriceProvider(productItem.productId);
      await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem: { ...productItem, unitPrice },
          },
        },

      );
      reply.code(204);
    },
  );
  app.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { shoppingCartId } = request.params as ShoppingCartItem;
      assertNotEmptyString(shoppingCartId);
      const { productId, quantity, unitPrice } = request.query as PricedProductItem;
      const productItem: PricedProductItem = {
        productId: assertNotEmptyString(productId),
        quantity: assertPositiveNumber(Number(quantity)),
        unitPrice: assertPositiveNumber(Number(unitPrice)),
      };

      await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'RemoveProductItemFromShoppingCart',
          data: { shoppingCartId, productItem },
        },
      );
      reply.code(204);
    },
  );
  app.post(
    '/clients/:clientId/shopping-carts/:shoppingCartId/confirm',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { shoppingCartId } = request.params as ShoppingCartItem;
      assertNotEmptyString(shoppingCartId);

      await handle(
        eventStore,
        shoppingCartId,
        {
          type: 'ConfirmShoppingCart',
          data: { shoppingCartId, now: new Date() },
        },

      );
      reply.code(204);
    },
  );
  app.delete(
    '/clients/:clientId/shopping-carts/:shoppingCartId',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const { shoppingCartId } = request.params as ShoppingCartItem;
      assertNotEmptyString(shoppingCartId);
      try {
        await handle(
          eventStore,
          shoppingCartId,
          {
            type: 'CancelShoppingCart',
            data: { shoppingCartId, now: new Date() },
          },
        );
      } catch (error) {
        reply.code(403).send({ detail: error.message });
      }
      reply.code(204);
    },
  );
};
