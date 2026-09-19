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
import shoppingCarts, { type ProductItem } from './';
import { shoppingCartApi } from './api';
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

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    const connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline(shoppingCarts.projections),
    });
    readStore = pongoClient({ connectionString, driver: pgDriver });

    const inMemoryMessageBus = getInMemoryMessageBus();

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
          shoppingCartUI(eventStore, readStore.db(), getUnitPrice, () => now),
        ],
      });

    application = getTestApplication(eventStore);
    given = ApiE2ESpecification.for(() => eventStore, getTestApplication);
  });

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
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
});
