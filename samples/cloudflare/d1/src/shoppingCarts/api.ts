import {
  assertNotEmptyString,
  assertUnsignedBigInt,
  asyncRetry,
  CommandHandler,
  isExpectedVersionConflictError,
  NotFoundError,
  STREAM_DOES_NOT_EXIST,
  ValidationError,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  Created,
  getETagValueFromIfMatch,
  OK,
  toWeakETag,
  type WebApiSetup,
} from '@event-driven-io/emmett-honojs';
import type { PongoDb } from '@event-driven-io/pongo';
import { validator } from 'hono/validator';
import { decide, type ShoppingCartCommand } from './businessLogic';
import type { ClientShoppingCarts, ShoppingCart } from './projections';
import { evolve, initialState, shoppingCartIdFor } from './shoppingCart';

type ShoppingCartApiDependencies = {
  eventStore: EventStore;
  pongoDb: PongoDb;
  getUnitPrice: (productId: string) => Promise<number>;
  getCurrentTime: () => Date;
};

const handle = CommandHandler({ evolve, initialState });

export const shoppingCartApi =
  ({
    eventStore,
    pongoDb,
    getUnitPrice,
    getCurrentTime,
  }: ShoppingCartApiDependencies): WebApiSetup =>
  (router) => {
    const shoppingCarts = pongoDb.collection<ShoppingCart>('shoppingCarts');
    const clientShoppingCarts = pongoDb.collection<ClientShoppingCarts>(
      'clientShoppingCarts',
    );

    const findShoppingCart = async (
      clientId: string,
      shoppingCartId: string,
    ) => {
      const cart = await shoppingCarts.findOne({
        _id: shoppingCartId,
        clientId,
      });
      if (cart === null)
        throw new NotFoundError({ id: shoppingCartId, type: 'Shopping cart' });

      return cart;
    };

    const changeShoppingCart = async (
      clientId: string,
      shoppingCartId: string,
      expectedStreamVersion: bigint,
      command: ShoppingCartCommand,
    ) => {
      await findShoppingCart(clientId, shoppingCartId);

      const { nextExpectedStreamVersion } = await handle(
        eventStore,
        shoppingCartId,
        (state) => decide(command, state),
        { expectedStreamVersion },
      );

      return {
        body: toResponseBody(await findShoppingCart(clientId, shoppingCartId)),
        eTag: toWeakETag(nextExpectedStreamVersion),
      };
    };

    router.post(
      '/clients/:clientId/shopping-carts/current/product-items',
      productItemBody,
      async (context) => {
        const { clientId } = context.req.param();
        const { productId, quantity } = context.req.valid('json');
        const unitPrice = await getUnitPrice(productId);
        const now = getCurrentTime();

        const { shoppingCartId, nextExpectedStreamVersion, created } =
          await asyncRetry(
            async () => {
              const pointer = await clientShoppingCarts.findOne({
                _id: clientId,
              });
              const created = pointer?.status !== 'Opened';
              const shoppingCartId = created
                ? shoppingCartIdFor(
                    clientId,
                    (pointer?.lastCartNumber ?? 0) + 1,
                  )
                : pointer.lastShoppingCartId;

              const { nextExpectedStreamVersion } = await handle(
                eventStore,
                shoppingCartId,
                (state) =>
                  decide(
                    {
                      type: 'AddProductItemToShoppingCart',
                      data: {
                        shoppingCartId,
                        clientId,
                        productItem: { productId, quantity, unitPrice },
                      },
                      metadata: { clientId, now },
                    },
                    state,
                  ),
                created
                  ? { expectedStreamVersion: STREAM_DOES_NOT_EXIST }
                  : undefined,
              );

              return { shoppingCartId, nextExpectedStreamVersion, created };
            },
            {
              retries: 3,
              minTimeout: 100,
              factor: 1.5,
              shouldRetryError: isExpectedVersionConflictError,
            },
          );

        const cart = await findShoppingCart(clientId, shoppingCartId);
        const body = toResponseBody(cart);
        const eTag = toWeakETag(nextExpectedStreamVersion);

        if (created)
          return Created({ context, url: shoppingCartUrl(cart), body, eTag });

        return OK({ context, body, eTag });
      },
    );

    router.get('/clients/:clientId/shopping-carts/current', async (context) => {
      const { clientId } = context.req.param();

      const cart = await shoppingCarts.findOne({ clientId, status: 'Opened' });
      if (cart === null)
        throw new NotFoundError({ id: clientId, type: 'Shopping cart' });

      return OK({
        context,
        body: toResponseBody(cart),
        eTag: toWeakETag(cart.streamPosition),
      });
    });

    router.get(
      '/clients/:clientId/shopping-carts/:shoppingCartId',
      async (context) => {
        const { clientId, shoppingCartId } = context.req.param();

        const cart = await findShoppingCart(clientId, shoppingCartId);

        return OK({
          context,
          body: toResponseBody(cart),
          eTag: toWeakETag(cart.streamPosition),
        });
      },
    );

    router.post(
      '/clients/:clientId/shopping-carts/:shoppingCartId/product-items',
      productItemBody,
      async (context) => {
        const { clientId, shoppingCartId } = context.req.param();
        const { productId, quantity } = context.req.valid('json');
        const unitPrice = await getUnitPrice(productId);
        const expectedVersion = assertUnsignedBigInt(
          getETagValueFromIfMatch(context),
        );

        const { body, eTag } = await changeShoppingCart(
          clientId,
          shoppingCartId,
          expectedVersion,
          {
            type: 'AddProductItemToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem: { productId, quantity, unitPrice },
            },
            metadata: { clientId, now: getCurrentTime() },
          },
        );

        return OK({ context, body, eTag });
      },
    );

    router.delete(
      '/clients/:clientId/shopping-carts/:shoppingCartId/product-items/:productId',
      async (context) => {
        const { clientId, shoppingCartId, productId } = context.req.param();
        const quantity = positiveInteger(
          context.req.query('quantity'),
          'quantity',
        );
        const expectedVersion = assertUnsignedBigInt(
          getETagValueFromIfMatch(context),
        );

        const { body, eTag } = await changeShoppingCart(
          clientId,
          shoppingCartId,
          expectedVersion,
          {
            type: 'RemoveProductItemFromShoppingCart',
            data: { shoppingCartId, productId, quantity },
            metadata: { clientId, now: getCurrentTime() },
          },
        );

        return OK({ context, body, eTag });
      },
    );

    router.post(
      '/clients/:clientId/shopping-carts/:shoppingCartId/confirm',
      async (context) => {
        const { clientId, shoppingCartId } = context.req.param();
        const expectedVersion = assertUnsignedBigInt(
          getETagValueFromIfMatch(context),
        );

        const { body, eTag } = await changeShoppingCart(
          clientId,
          shoppingCartId,
          expectedVersion,
          {
            type: 'ConfirmShoppingCart',
            data: { shoppingCartId },
            metadata: { clientId, now: getCurrentTime() },
          },
        );

        return OK({ context, body, eTag });
      },
    );

    router.post(
      '/clients/:clientId/shopping-carts/:shoppingCartId/cancel',
      async (context) => {
        const { clientId, shoppingCartId } = context.req.param();
        const expectedVersion = assertUnsignedBigInt(
          getETagValueFromIfMatch(context),
        );

        const { body, eTag } = await changeShoppingCart(
          clientId,
          shoppingCartId,
          expectedVersion,
          {
            type: 'CancelShoppingCart',
            data: { shoppingCartId },
            metadata: { clientId, now: getCurrentTime() },
          },
        );

        return OK({ context, body, eTag });
      },
    );
  };

type ProductItemRequest = { productId?: unknown; quantity?: unknown };

const productItemBody = validator('json', (body: ProductItemRequest) => ({
  productId: assertNotEmptyString(body.productId),
  quantity: positiveInteger(body.quantity, 'quantity'),
}));

const positiveInteger = (value: unknown, name: string): number => {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0)
    throw new ValidationError(`${name} must be a positive integer`);
  return number;
};

const toResponseBody = ({
  _version,
  streamPosition: _streamPosition,
  ...body
}: ShoppingCart & { _version?: bigint }) => body;

const shoppingCartUrl = (cart: ShoppingCart) =>
  `/clients/${encodeURIComponent(cart.clientId)}/shopping-carts/${encodeURIComponent(cart._id)}`;
