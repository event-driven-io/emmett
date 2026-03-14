import {
  getInMemoryMessageBus,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import { getOpossumEventStore } from '@event-driven-io/emmett-opossum';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { type ProductItem } from '.';
import { getShoppingCartId, shoppingCartApi } from './api';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

void describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;
  let given: ApiE2ESpecification;
  let tempDir: string;

  beforeEach(async () => {
    clientId = uuid();
    shoppingCartId = getShoppingCartId(clientId);
    tempDir = await mkdtemp(join(tmpdir(), 'opossum-e2e-'));

    const eventStore = await getOpossumEventStore({
      storeName: `test-${randomUUID()}`,
      rootPath: tempDir,
    });

    const inMemoryMessageBus = getInMemoryMessageBus();

    given = ApiE2ESpecification.for(
      () => eventStore,
      (eventStore: EventStore) =>
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

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
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
              productItems: [
                {
                  ...productItem,
                  unitPrice,
                  totalPrice: unitPrice * productItem.quantity,
                },
              ],
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
