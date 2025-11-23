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
  getSQLiteEventStore,
  SQLiteConnectionPool,
  type SQLiteEventStore,
} from '@event-driven-io/emmett-sqlite';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import shoppingCarts, { type ProductItem } from '.';
import { getShoppingCartId, shoppingCartApi } from './api';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

void describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;
  let eventStore: SQLiteEventStore;
  let given: ApiE2ESpecification;

  const testDatabasePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
  );
  const fileName = path.resolve(testDatabasePath, 'test.db');
  let pool: SQLiteConnectionPool;

  beforeEach(async () => {
    clientId = uuid();
    shoppingCartId = getShoppingCartId(clientId);

    pool = SQLiteConnectionPool({ fileName });

    eventStore = getSQLiteEventStore({
      fileName,
      projections: projections.inline(shoppingCarts.readModel.projections),
      schema: { autoMigration: 'None' },
      pool,
    });

    await eventStore.schema.migrate();

    const inMemoryMessageBus = getInMemoryMessageBus();

    given = ApiE2ESpecification.for(
      () => eventStore,
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            shoppingCartApi(
              eventStore,
              pool,
              inMemoryMessageBus,
              getUnitPrice,
              () => now,
            ),
          ],
        }),
    );
  });

  afterEach(() => {
    if (!fs.existsSync(fileName)) {
      return;
    }
    try {
      fs.unlinkSync(fileName);
    } catch (error) {
      console.log('Error deleting file:', error);
    }
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
              id: shoppingCartId,
              productItems: [{ ...productItem, unitPrice }],
              productItemsCount: productItem.quantity,
              totalAmount: unitPrice * productItem.quantity,
              status: 'Opened',
            },
          }),
        ]);
    });

    void it.skip('gets shopping cart summary', () => {
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
