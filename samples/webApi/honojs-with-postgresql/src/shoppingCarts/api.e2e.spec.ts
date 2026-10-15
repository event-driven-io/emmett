import {
  getInMemoryMessageBus,
  projections,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-honojs';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '@event-driven-io/emmett-postgresql';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import { pgDriver } from '@event-driven-io/pongo/pg';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Hono } from 'hono';
import shoppingCarts, {
  type ProductItem,
  type ShoppingCartConfirmed,
} from './';
import { shoppingCartApi } from './api';
import { getDetailsById } from './getDetails';
import { shoppingCartUI } from './ui';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

void describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;
  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;
  let readStore: PongoClient;
  let given: ApiE2ESpecification;
  let application: Hono;
  let publishedEvents: ShoppingCartConfirmed[];

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    const connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline(shoppingCarts.projections),
    });
    readStore = pongoClient({ connectionString, driver: pgDriver });

    const inMemoryMessageBus = getInMemoryMessageBus();
    inMemoryMessageBus.subscribe((event: ShoppingCartConfirmed) => {
      publishedEvents.push(event);
    }, 'ShoppingCartConfirmed');

    const getTestApplication = (eventStore: EventStore) =>
      getApplication({
        apis: [
          shoppingCartApi(
            eventStore,
            readStore.db(),
            inMemoryMessageBus,
            getUnitPrice,
            () => now,
          ),
          shoppingCartUI(
            eventStore,
            readStore.db(),
            inMemoryMessageBus,
            getUnitPrice,
            () => now,
          ),
        ],
      });

    application = getTestApplication(eventStore);
    given = ApiE2ESpecification.for(() => eventStore, getTestApplication);
  });

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
    publishedEvents = [];
  });

  after(async () => {
    await readStore.close();
    await eventStore.close();
  });

  void describe('When empty', () => {
    void it('should add product item', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([expectResponse(204)]);
    });

    void it('renders the shopping cart UI', async () => {
      const response = await application.request(
        `/ui/clients/${clientId}/shopping-carts/current`,
      );

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html/);

      const body = await response.text();
      assert.match(body, /^<!DOCTYPE html>/);
      assert.match(body, /Your shopping cart is empty\./);
      assert.match(body, /hx-post=/);
      assert.match(body, /name="productId"/);
      assert.match(body, /name="quantity"/);
      assert.doesNotMatch(body, /Confirm cart/);
    });

    void it('redirects the UI entry point to the demo cart', async () => {
      const response = await application.request('/ui');

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get('location'),
        '/ui/clients/demo/shopping-carts/current',
      );
    });

    void it('adds and displays a product through HTMX', async () => {
      const firstResponse = await postProductItem({
        productId: 'product-1',
        quantity: 2,
        htmx: true,
      });

      assert.equal(firstResponse.status, 200);
      assert.match(
        firstResponse.headers.get('content-type') ?? '',
        /^text\/html/,
      );

      const firstBody = await firstResponse.text();
      assert.doesNotMatch(firstBody, /<!DOCTYPE html>/);
      assert.match(firstBody, /<section id="shopping-cart"/);
      assert.match(firstBody, /product-1/);
      assert.match(firstBody, /<td>2<\/td>/);
      assert.match(firstBody, /<strong>200<\/strong>/);

      const { events } = await eventStore.readStream(shoppingCartId);
      assert.deepEqual(
        events.map(({ type }) => type),
        ['ProductItemAddedToShoppingCart'],
      );

      const secondResponse = await postProductItem({
        productId: 'product-1',
        quantity: 3,
        htmx: true,
      });
      const secondBody = await secondResponse.text();

      assert.equal(secondResponse.status, 200);
      assert.match(secondBody, /<td>5<\/td>/);
      assert.match(secondBody, /<strong>500<\/strong>/);
    });

    void it('redirects a regular form submission to the cart page', async () => {
      const response = await postProductItem({
        productId: 'product-1',
        quantity: 1,
        htmx: false,
      });

      assert.equal(response.status, 303);
      assert.equal(
        response.headers.get('location'),
        `/ui/clients/${clientId}/shopping-carts/current`,
      );
    });
  });

  void describe('When open', () => {
    const openedShoppingCart: TestRequest = (request) =>
      request
        .post(`/clients/${clientId}/shopping-carts/current/product-items`)
        .send(productItem);

    void it('gets shopping cart details', () => {
      return given(openedShoppingCart)
        .when((request) =>
          request.get(`/clients/${clientId}/shopping-carts/current`).send(),
        )
        .then([
          expectResponse(200, {
            body: {
              clientId,
              _id: shoppingCartId,
              productItems: [{ ...productItem, unitPrice }],
              productItemsCount: productItem.quantity,
              totalAmount: unitPrice * productItem.quantity,
              status: 'Opened',
            },
          }),
        ]);
    });

    void it('gets shopping cart summary', () => {
      return given(openedShoppingCart)
        .when((request) =>
          request.get(`/clients/${clientId}/shopping-carts/summary`).send(),
        )
        .then([
          expectResponse(200, {
            body: {
              clientId,
              pending: {
                cartId: shoppingCartId,
                productItemsCount: productItem.quantity,
                totalAmount: unitPrice * productItem.quantity,
              },
              confirmed: {
                cartsCount: 0,
                productItemsCount: 0,
                totalAmount: 0,
              },
              cancelled: {
                cartsCount: 0,
                productItemsCount: 0,
                totalAmount: 0,
              },
            },
          }),
        ]);
    });

    void it('removes the entire product row through HTMX', async () => {
      await postProductItem({
        productId: 'product-to-remove',
        quantity: 2,
        htmx: true,
      });

      const response = await removeProductItem({
        productId: 'product-to-remove',
        unitPrice,
        method: 'DELETE',
        htmx: true,
      });

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /Your shopping cart is empty\./);
      assert.match(body, /<strong>0 items<\/strong>/);
      assert.doesNotMatch(body, /product-to-remove/);
      assert.doesNotMatch(body, /Confirm cart/);
      assert.match(body, /Cancel cart/);

      const details = await getDetailsById(readStore.db(), shoppingCartId);
      assert.deepEqual(details?.productItems, []);
      assert.equal(details?.productItemsCount, 0);
      assert.equal(details?.totalAmount, 0);

      const { events } = await eventStore.readStream(shoppingCartId);
      const removed = events.at(-1);
      assert.equal(removed?.type, 'ProductItemRemovedFromShoppingCart');
      assert.deepEqual(removed?.data.productItem, {
        productId: 'product-to-remove',
        quantity: 2,
        unitPrice,
      });
    });

    void it('redirects after removing a product without HTMX', async () => {
      await postProductItem({
        productId: 'product-to-remove',
        quantity: 1,
        htmx: true,
      });

      const response = await removeProductItem({
        productId: 'product-to-remove',
        unitPrice,
        method: 'POST',
        htmx: false,
      });

      assert.equal(response.status, 303);
      assert.equal(
        response.headers.get('location'),
        `/ui/clients/${clientId}/shopping-carts/current`,
      );
    });

    void it('confirms the cart through HTMX and publishes the event', async () => {
      await postProductItem({
        productId: 'product-to-confirm',
        quantity: 1,
        htmx: true,
      });

      const response = await submitCartAction('confirm', true);

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /This shopping cart is confirmed\./);
      assert.doesNotMatch(body, /Add product|Remove|Confirm cart|Cancel cart/);

      const { events } = await eventStore.readStream(shoppingCartId);
      const confirmed = events.at(-1);
      assert.equal(confirmed?.type, 'ShoppingCartConfirmed');
      assert.equal(confirmed?.data.shoppingCartId, shoppingCartId);
      assert.deepEqual(publishedEvents, [
        {
          type: 'ShoppingCartConfirmed',
          data: { shoppingCartId, confirmedAt: now },
          metadata: { clientId },
        },
      ]);
    });

    void it('redirects after confirming the cart without HTMX', async () => {
      await postProductItem({
        productId: 'product-to-confirm',
        quantity: 1,
        htmx: true,
      });

      const response = await submitCartAction('confirm', false);

      assert.equal(response.status, 303);
      assert.equal(
        response.headers.get('location'),
        `/ui/clients/${clientId}/shopping-carts/current`,
      );
    });

    void it('cancels the cart through HTMX', async () => {
      await postProductItem({
        productId: 'product-to-cancel',
        quantity: 1,
        htmx: true,
      });

      const response = await submitCartAction('cancel', true, 'DELETE');

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /This shopping cart is cancelled\./);
      assert.doesNotMatch(body, /Add product|Remove|Confirm cart|Cancel cart/);

      const { events } = await eventStore.readStream(shoppingCartId);
      assert.equal(events.at(-1)?.type, 'ShoppingCartCancelled');
    });

    void it('redirects after cancelling the cart without HTMX', async () => {
      await postProductItem({
        productId: 'product-to-cancel',
        quantity: 1,
        htmx: true,
      });

      const response = await submitCartAction('cancel', false, 'POST');

      assert.equal(response.status, 303);
      assert.equal(
        response.headers.get('location'),
        `/ui/clients/${clientId}/shopping-carts/current`,
      );
    });

    void it('returns Problem Details when the product row does not exist', async () => {
      const response = await removeProductItem({
        productId: 'missing-product',
        unitPrice,
        method: 'DELETE',
        htmx: true,
      });

      assert.equal(response.status, 404);
      assert.match(
        response.headers.get('content-type') ?? '',
        /^application\/problem\+json/,
      );
      assert.equal(
        ((await response.json()) as { detail: string }).detail,
        'Product item not found',
      );
    });
  });

  const now = new Date();
  const unitPrice = 100;

  const getRandomProduct = (): ProductItem => {
    return {
      productId: randomUUID(),
      quantity: 1 + Math.floor(Math.random() * 10),
    };
  };

  const productItem = getRandomProduct();

  const postProductItem = (options: {
    productId: string;
    quantity: number;
    htmx: boolean;
  }) => {
    const { productId, quantity, htmx } = options;

    return application.request(
      `/ui/clients/${clientId}/shopping-carts/current/product-items`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(htmx ? { 'HX-Request': 'true' } : {}),
        },
        body: new URLSearchParams({
          productId,
          quantity: quantity.toString(),
        }),
      },
    );
  };

  const removeProductItem = (options: {
    productId: string;
    unitPrice: number;
    method: 'DELETE' | 'POST';
    htmx: boolean;
  }) => {
    const { productId, unitPrice, method, htmx } = options;

    return application.request(
      `/ui/clients/${clientId}/shopping-carts/current/product-items/${encodeURIComponent(productId)}?unitPrice=${unitPrice}`,
      {
        method,
        headers: htmx ? { 'HX-Request': 'true' } : undefined,
      },
    );
  };

  const submitCartAction = (
    action: 'confirm' | 'cancel',
    htmx: boolean,
    method: 'DELETE' | 'POST' = 'POST',
  ) =>
    application.request(
      `/ui/clients/${clientId}/shopping-carts/current/${action}`,
      {
        method,
        headers: htmx ? { 'HX-Request': 'true' } : undefined,
      },
    );
});
