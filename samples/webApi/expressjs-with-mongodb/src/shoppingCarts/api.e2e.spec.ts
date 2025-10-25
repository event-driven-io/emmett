import { getInMemoryMessageBus, projections } from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import {
  getMongoDBEventStore,
  type MongoDBEventStore,
} from '@event-driven-io/emmett-mongodb';
import {
  MongoDBContainer,
  StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import shoppingCarts, { type ProductItem } from './';
import { shoppingCartApi } from './api';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

void describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;
  let mongodb: StartedMongoDBContainer;
  let eventStore: MongoDBEventStore;
  let readStore: MongoClient;
  let given: ApiE2ESpecification;

  before(async () => {
    mongodb = await new MongoDBContainer('mongo:6.0.1').start();
    const connectionString = mongodb.getConnectionString();

    readStore = new MongoClient(connectionString, {
      directConnection: true,
    });
    eventStore = getMongoDBEventStore({
      client: readStore,
      projections: projections.inline(shoppingCarts.projections),
    });

    const inMemoryMessageBus = getInMemoryMessageBus();

    given = ApiE2ESpecification.for(
      () => eventStore,
      (eventStore) =>
        getApplication({
          apis: [
            shoppingCartApi(
              eventStore,
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
              id: shoppingCartId,
              clientId,
              productItems: [{ ...productItem, unitPrice }],
              productItemsCount: productItem.quantity,
              totalAmount: unitPrice * productItem.quantity,
              status: 'Opened',
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
