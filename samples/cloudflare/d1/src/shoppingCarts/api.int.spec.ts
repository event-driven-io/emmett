import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
  type HonoResponse,
  type TestRequest,
} from '@event-driven-io/emmett-honojs';
import type { SQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { eventStore } from '../eventStore';
import { pongoDb } from '../pongo';
import { shoppingCartsCollection } from '../pongo.config';
import { shoppingCartApi } from './api';
import { getUnitPrice } from './pricing';
import type { PricedProductItem, ShoppingCartEvent } from './shoppingCart';

describe('D1 shopping-cart API integration', () => {
  beforeAll(async () => {
    await eventStore.schema.migrate();
  });

  it('indexes shopping carts by client and status', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`,
    )
      .bind(shoppingCartsCollection.tableName)
      .all<{ name: string }>();

    expect(results.map(({ name }) => name)).toContain(
      'shopping_carts_by_client_status',
    );
  });

  it('starts a shopping cart by adding the first product', () => {
    const cart = shoppingCart();

    return given()
      .when(openShoppingCart(cart, { productId: 'product-1', quantity: 2 }))
      .then([
        async (response) => {
          await expectResponse(201, {
            headers: { etag: 'W/"2"' },
            body: {
              _id: cart.shoppingCartId,
              clientId: cart.clientId,
              productItems: [
                { productId: 'product-1', quantity: 2, unitPrice: 1000 },
              ],
              productItemsCount: 2,
              totalAmount: 2000,
              status: 'Opened',
            },
          })(response);
          expect(response.headers.location).toBe(cart.location);
        },
        expectNewEvents(cart.shoppingCartId, [
          opened(cart),
          added(cart, { productId: 'product-1', quantity: 2 }),
        ]),
      ]);
  });

  it('allows a client to revisit a known shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 2,
      }),
    )
      .when(getShoppingCart(cart))
      .then(
        expectResponse(200, {
          body: {
            clientId: cart.clientId,
            productItems: [
              { productId: 'product-1', quantity: 2, unitPrice: 1000 },
            ],
            productItemsCount: 2,
            totalAmount: 2000,
            status: 'Opened',
            openedAt: now.toISOString(),
          },
          headers: { etag: 'W/"2"' },
        }),
      );
  });

  it.each([
    ['view', (cart: TestShoppingCart) => getShoppingCart(cart)],
    [
      'add a product to',
      (cart: TestShoppingCart) =>
        addProductToShoppingCart(cart, 'product-2', 1),
    ],
    [
      'remove a product from',
      (cart: TestShoppingCart) =>
        removeProductFromShoppingCart(cart, 'product-1', 1),
    ],
    ['confirm', (cart: TestShoppingCart) => confirmShoppingCart(cart)],
    ['cancel', (cart: TestShoppingCart) => cancelShoppingCart(cart)],
  ])(
    'does not allow another client to %s a shopping cart',
    (_action, accessShoppingCart) => {
      const ownerCart = shoppingCart();

      return given(
        openedShoppingCart(ownerCart, {
          productId: 'product-1',
          quantity: 2,
        }),
      )
        .when(accessAsAnotherClient(ownerCart, accessShoppingCart))
        .then(expectError(404));
    },
  );

  it('allows a client to find their active shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(getCurrentShoppingCart(cart))
      .then(
        expectResponse(200, {
          body: {
            _id: cart.shoppingCartId,
            clientId: cart.clientId,
            status: 'Opened',
          },
          headers: { etag: 'W/"2"' },
        }),
      );
  });

  it('adds another product to an opened shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(addProductToShoppingCart(cart, 'product-2', 1))
      .then(
        expectResponse(200, {
          body: {
            productItems: [
              { productId: 'product-1', quantity: 1, unitPrice: 1000 },
              { productId: 'product-2', quantity: 1, unitPrice: 2500 },
            ],
            productItemsCount: 2,
            totalAmount: 3500,
            status: 'Opened',
          },
          headers: { etag: 'W/"3"' },
        }),
      );
  });

  it('shows all products added to a shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(
        cart,
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 1 },
      ),
    )
      .when(getShoppingCart(cart))
      .then(
        expectResponse(200, {
          body: {
            productItems: [
              { productId: 'product-1', quantity: 1, unitPrice: 1000 },
              { productId: 'product-2', quantity: 1, unitPrice: 2500 },
            ],
            productItemsCount: 2,
            totalAmount: 3500,
          },
          headers: { etag: 'W/"3"' },
        }),
      );
  });

  it('reduces the product quantity in a shopping cart', () => {
    const cart = shoppingCart();

    return given(
      existingStream<ShoppingCartEvent>(cart.shoppingCartId, [
        opened(cart),
        added(cart, { productId: 'product-1', quantity: 2 }),
        removed(cart, { productId: 'product-1', quantity: 1 }),
      ]),
    )
      .when(getShoppingCart(cart))
      .then(
        expectResponse(200, {
          body: {
            productItems: [
              { productId: 'product-1', quantity: 1, unitPrice: 1000 },
            ],
            productItemsCount: 1,
            totalAmount: 1000,
            status: 'Opened',
          },
          headers: { etag: 'W/"3"' },
        }),
      );
  });

  it('does not confirm an empty shopping cart', () => {
    const cart = shoppingCart();

    return given(
      existingStream<ShoppingCartEvent>(cart.shoppingCartId, [
        opened(cart),
        added(cart, { productId: 'product-1', quantity: 1 }),
        removed(cart, { productId: 'product-1', quantity: 1 }),
      ]),
    )
      .when(confirmShoppingCart(cart, 'W/"3"'))
      .then(expectError(409));
  });

  it('confirms an opened shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(confirmShoppingCart(cart))
      .then([
        expectResponse(200, {
          body: { status: 'Confirmed' },
          headers: { etag: 'W/"3"' },
        }),
        expectNewEvents(cart.shoppingCartId, [confirmed(cart)]),
      ]);
  });

  it('allows a client to safely retry confirmation', () => {
    const cart = shoppingCart();

    return given(
      confirmedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(confirmShoppingCart(cart, 'W/"3"'))
      .then([
        expectResponse(200, {
          headers: { etag: 'W/"3"' },
          body: { status: 'Confirmed' },
        }),
      ]);
  });

  it('stops treating a confirmed shopping cart as active', () => {
    const cart = shoppingCart();

    return given(
      confirmedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(getCurrentShoppingCart(cart))
      .then(expectError(404));
  });

  it('starts a new shopping cart after confirming the previous one', () => {
    const previousCart = shoppingCart();
    const nextCart = shoppingCart(previousCart.clientId, 2);

    return given(
      confirmedShoppingCart(previousCart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(openShoppingCart(nextCart, { productId: 'product-2', quantity: 1 }))
      .then(async (response) => {
        await expectResponse(201, { headers: { etag: 'W/"2"' } })(response);
        expect(response.headers.location).toBe(nextCart.location);
        expect(response.headers.location).not.toBe(previousCart.location);
      });
  });

  it('cancels an opened shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(cancelShoppingCart(cart))
      .then([
        expectResponse(200, {
          body: { status: 'Cancelled' },
          headers: { etag: 'W/"3"' },
        }),
        expectNewEvents(cart.shoppingCartId, [cancelled(cart)]),
      ]);
  });

  it('allows a client to safely retry cancellation', () => {
    const cart = shoppingCart();

    return given(
      cancelledShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(cancelShoppingCart(cart, 'W/"3"'))
      .then([
        expectResponse(200, {
          headers: { etag: 'W/"3"' },
          body: { status: 'Cancelled' },
        }),
      ]);
  });

  it('does not add products to a cancelled shopping cart', () => {
    const cart = shoppingCart();

    return given(
      cancelledShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(addProductToShoppingCart(cart, 'product-1', 1, 'W/"3"'))
      .then(expectError(409));
  });

  it('stops treating a cancelled shopping cart as active', () => {
    const cart = shoppingCart();

    return given(
      cancelledShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(getCurrentShoppingCart(cart))
      .then(expectError(404));
  });

  it('starts a new shopping cart after cancelling the previous one', () => {
    const previousCart = shoppingCart();
    const nextCart = shoppingCart(previousCart.clientId, 2);

    return given(
      cancelledShoppingCart(previousCart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(openShoppingCart(nextCart, { productId: 'product-2', quantity: 1 }))
      .then(async (response) => {
        await expectResponse(201, { headers: { etag: 'W/"2"' } })(response);
        expect(response.headers.location).toBe(nextCart.location);
        expect(response.headers.location).not.toBe(previousCart.location);
      });
  });

  it.each([
    [
      'add a product',
      (cart: TestShoppingCart) =>
        addProductToShoppingCart(cart, 'product-1', 1),
    ],
    [
      'remove a product',
      (cart: TestShoppingCart) =>
        removeProductFromShoppingCart(cart, 'product-1', 1),
    ],
    ['confirm it', (cart: TestShoppingCart) => confirmShoppingCart(cart)],
    ['cancel it', (cart: TestShoppingCart) => cancelShoppingCart(cart)],
  ])(
    'does not %s when the shopping cart does not exist',
    (_action, changeShoppingCart) => {
      const cart = shoppingCart();

      return given().when(changeShoppingCart(cart)).then(expectError(404));
    },
  );

  it('does not add a product based on an out-of-date shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(
        cart,
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 1 },
      ),
    )
      .when(addProductToShoppingCart(cart, 'product-2', 1, 'W/"2"'))
      .then(expectError(412, { status: 412, title: 'Precondition Failed' }));
  });

  it('does not remove a product based on an out-of-date shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(
        cart,
        { productId: 'product-1', quantity: 2 },
        { productId: 'product-2', quantity: 1 },
      ),
    )
      .when(removeProductFromShoppingCart(cart, 'product-1', 1, 'W/"2"'))
      .then(expectError(412, { status: 412, title: 'Precondition Failed' }));
  });

  it('does not confirm an out-of-date shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(
        cart,
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 1 },
      ),
    )
      .when(confirmShoppingCart(cart, 'W/"2"'))
      .then(expectError(412, { status: 412, title: 'Precondition Failed' }));
  });

  it('does not cancel an out-of-date shopping cart', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(
        cart,
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 1 },
      ),
    )
      .when(cancelShoppingCart(cart, 'W/"2"'))
      .then(expectError(412, { status: 412, title: 'Precondition Failed' }));
  });

  it('requires changes to be based on the current shopping cart state', () => {
    const cart = shoppingCart();

    return given(
      openedShoppingCart(cart, {
        productId: 'product-1',
        quantity: 1,
      }),
    )
      .when(addProductWithoutETag(cart, 'product-2', 1))
      .then(expectError(412, { status: 412, title: 'Precondition Failed' }));
  });

  it.each([
    // TODO: bring back once Emmett maps Hono's HTTPException status to problem details; today a missing body answers 500
    // ['a missing request body', undefined],
    ['a missing product identifier', { quantity: 1 }],
    ['an empty product identifier', { productId: '', quantity: 1 }],
    ['a missing quantity', { productId: 'product-1' }],
    ['a non-positive quantity', { productId: 'product-1', quantity: 0 }],
    ['a non-integer quantity', { productId: 'product-1', quantity: 1.5 }],
    ['an unknown product', { productId: 'unknown', quantity: 1 }],
  ])('rejects %s', (_case, body) => {
    const cart = shoppingCart();

    return given()
      .when(addInvalidProductToCurrentShoppingCart(cart, body))
      .then(expectError(400, { status: 400, title: 'Bad Request' }));
  });

  it('keeps one active cart when first products are added concurrently', async () => {
    const cart = shoppingCart();
    const first = requestResult();
    const second = requestResult();

    await Promise.all([
      given()
        .when(openShoppingCart(cart, { productId: 'product-1', quantity: 1 }))
        .then(captureResponse(first)),
      given()
        .when(openShoppingCart(cart, { productId: 'product-2', quantity: 1 }))
        .then(captureResponse(second)),
    ]);

    await given()
      .when(getCurrentShoppingCart(cart))
      .then(async (response) => {
        expect([first.status, second.status].sort()).toEqual([200, 201]);
        expect(first.shoppingCartId).toBe(cart.shoppingCartId);
        expect(second.shoppingCartId).toBe(cart.shoppingCartId);

        const productItems = [
          { productId: 'product-1', quantity: 1, unitPrice: 1000 },
          { productId: 'product-2', quantity: 1, unitPrice: 2500 },
        ];
        if (second.status === 201) productItems.reverse();

        await expectResponse(200, {
          body: {
            _id: cart.shoppingCartId,
            clientId: cart.clientId,
            productItems,
            productItemsCount: 2,
            totalAmount: 3500,
            status: 'Opened',
          },
          headers: { etag: 'W/"3"' },
        })(response);
      });
  });
});

const now = new Date('2026-09-13T10:00:00.000Z');

const given = ApiSpecification.for<ShoppingCartEvent, SQLiteEventStore>({
  getEventStore: () => eventStore,
  getApplication: (eventStore) =>
    getApplication({
      apis: [
        shoppingCartApi({
          eventStore,
          pongoDb,
          getUnitPrice,
          getCurrentTime: () => now,
        }),
      ],
    }),
});

type ProductItemRequest = Readonly<{ productId: string; quantity: number }>;

type TestShoppingCart = {
  clientId: string;
  shoppingCartId: string;
  location: string;
};

const shoppingCart = (
  clientId: string = crypto.randomUUID(),
  cartNumber = 1,
): TestShoppingCart => {
  const shoppingCartId = `shopping_cart-${clientId}:${cartNumber}`;
  return {
    clientId,
    shoppingCartId,
    location: `/clients/${clientId}/shopping-carts/${encodeURIComponent(shoppingCartId)}`,
  };
};

const unitPrices: Record<string, number> = {
  'product-1': 1000,
  'product-2': 2500,
};

const priced = ({
  productId,
  quantity,
}: ProductItemRequest): PricedProductItem => ({
  productId,
  quantity,
  unitPrice: unitPrices[productId],
});

const opened = ({
  clientId,
  shoppingCartId,
}: TestShoppingCart): ShoppingCartEvent => ({
  type: 'ShoppingCartOpened',
  data: { shoppingCartId, clientId, openedAt: now },
  metadata: { clientId },
});

const added = (
  { clientId, shoppingCartId }: TestShoppingCart,
  productItem: ProductItemRequest,
): ShoppingCartEvent => ({
  type: 'ProductItemAddedToShoppingCart',
  data: {
    shoppingCartId,
    clientId,
    productItem: priced(productItem),
    addedAt: now,
  },
  metadata: { clientId },
});

const removed = (
  { clientId, shoppingCartId }: TestShoppingCart,
  productItem: ProductItemRequest,
): ShoppingCartEvent => ({
  type: 'ProductItemRemovedFromShoppingCart',
  data: { shoppingCartId, productItem: priced(productItem), removedAt: now },
  metadata: { clientId },
});

const confirmed = ({
  clientId,
  shoppingCartId,
}: TestShoppingCart): ShoppingCartEvent => ({
  type: 'ShoppingCartConfirmed',
  data: { shoppingCartId, confirmedAt: now },
  metadata: { clientId },
});

const cancelled = ({
  clientId,
  shoppingCartId,
}: TestShoppingCart): ShoppingCartEvent => ({
  type: 'ShoppingCartCancelled',
  data: { shoppingCartId, cancelledAt: now },
  metadata: { clientId },
});

const openedShoppingCart = (
  cart: TestShoppingCart,
  ...productItems: [ProductItemRequest, ...ProductItemRequest[]]
) =>
  existingStream<ShoppingCartEvent>(cart.shoppingCartId, [
    opened(cart),
    ...productItems.map((productItem) => added(cart, productItem)),
  ]);

const confirmedShoppingCart = (
  cart: TestShoppingCart,
  ...productItems: [ProductItemRequest, ...ProductItemRequest[]]
) =>
  existingStream<ShoppingCartEvent>(cart.shoppingCartId, [
    opened(cart),
    ...productItems.map((productItem) => added(cart, productItem)),
    confirmed(cart),
  ]);

const cancelledShoppingCart = (
  cart: TestShoppingCart,
  ...productItems: [ProductItemRequest, ...ProductItemRequest[]]
) =>
  existingStream<ShoppingCartEvent>(cart.shoppingCartId, [
    opened(cart),
    ...productItems.map((productItem) => added(cart, productItem)),
    cancelled(cart),
  ]);

const accessAsAnotherClient = (
  ownerCart: TestShoppingCart,
  accessShoppingCart: (cart: TestShoppingCart) => TestRequest,
): TestRequest => {
  const clientId = crypto.randomUUID();
  return (request) =>
    accessShoppingCart({
      ...ownerCart,
      clientId,
      location: `/clients/${clientId}/shopping-carts/${encodeURIComponent(ownerCart.shoppingCartId)}`,
    })(request);
};

const openShoppingCart =
  (cart: TestShoppingCart, productItem: ProductItemRequest): TestRequest =>
  (request) =>
    request
      .post(`/clients/${cart.clientId}/shopping-carts/current/product-items`)
      .send(productItem);

const addProductToShoppingCart =
  (
    cart: TestShoppingCart,
    productId: string,
    quantity: number,
    eTag = 'W/"2"',
  ): TestRequest =>
  (request) =>
    request
      .post(`${cart.location}/product-items`)
      .set({ 'If-Match': eTag })
      .send({ productId, quantity });

const addProductWithoutETag =
  (cart: TestShoppingCart, productId: string, quantity: number): TestRequest =>
  (request) =>
    request
      .post(`${cart.location}/product-items`)
      .send({ productId, quantity });

const addInvalidProductToCurrentShoppingCart =
  (cart: TestShoppingCart, body: unknown): TestRequest =>
  (request) =>
    request
      .post(`/clients/${cart.clientId}/shopping-carts/current/product-items`)
      .send(body);

const removeProductFromShoppingCart =
  (
    cart: TestShoppingCart,
    productId: string,
    quantity: number,
    eTag = 'W/"2"',
  ): TestRequest =>
  (request) =>
    request
      .delete(
        `${cart.location}/product-items/${productId}?quantity=${quantity}`,
      )
      .set({ 'If-Match': eTag });

const confirmShoppingCart =
  (cart: TestShoppingCart, eTag = 'W/"2"'): TestRequest =>
  (request) =>
    request.post(`${cart.location}/confirm`).set({ 'If-Match': eTag });

const cancelShoppingCart =
  (cart: TestShoppingCart, eTag = 'W/"2"'): TestRequest =>
  (request) =>
    request.post(`${cart.location}/cancel`).set({ 'If-Match': eTag });

const getShoppingCart =
  (cart: TestShoppingCart): TestRequest =>
  (request) =>
    request.get(cart.location);

const getCurrentShoppingCart =
  (cart: TestShoppingCart): TestRequest =>
  (request) =>
    request.get(`/clients/${cart.clientId}/shopping-carts/current`);

type RequestResult = { status: number; shoppingCartId: string };

const requestResult = (): RequestResult => ({ status: 0, shoppingCartId: '' });

const captureResponse =
  (result: RequestResult) => async (response: HonoResponse) => {
    const body = (await response.json()) as { _id?: string } | null;
    result.status = response.status;
    result.shoppingCartId = body?._id ?? '';
  };
