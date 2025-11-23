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
} from '@event-driven-io/emmett-expressjs';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '@event-driven-io/emmett-postgresql';
import { pongoClient, type PongoClient } from '@event-driven-io/pongo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import shoppingCarts, { type ProductItem } from '.';
import { shoppingCartApi } from './api';

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

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    const connectionString = postgres.getConnectionUri();

    eventStore = getPostgreSQLEventStore(connectionString, {
      projections: projections.inline(shoppingCarts.projections),
    });
    readStore = pongoClient(connectionString);

    const inMemoryMessageBus = getInMemoryMessageBus();

    given = ApiE2ESpecification.for(
      () => eventStore,
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            shoppingCartApi(
              eventStore,
              readStore.db(),
              inMemoryMessageBus,
              getUnitPrice,
              () => now,
            ),
          ],
        }),
    );
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
      quantity: Math.floor(Math.random() * 10),
    };
  };

  const productItem = getRandomProduct();
});
