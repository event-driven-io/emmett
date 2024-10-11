import { after, before, beforeEach, describe, it } from 'node:test';
import type { PricedProductItem } from '../events';
import { ShoppingCartStatus } from './shoppingCart';
import { shoppingCartApi } from './simpleApi';

// #region getting-started-e2e-tests
import { type EventStore } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { randomUUID } from 'node:crypto';

void describe('ShoppingCart E2E', () => {
  const unitPrice = 100;
  let clientId: string;
  let shoppingCartId: string;
  let esdbContainer: StartedEventStoreDBContainer;
  let given: ApiE2ESpecification;

  before(async () => {
    esdbContainer = await new EventStoreDBContainer().start();

    given = ApiE2ESpecification.for(
      (): EventStore => getEventStoreDBEventStore(esdbContainer.getClient()),
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            shoppingCartApi(
              eventStore,
              () => Promise.resolve(unitPrice),
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

  after(() => {
    return esdbContainer.stop();
  });

  void describe('When opened with product item', () => {
    const openedShoppingCartWithProduct: TestRequest = (request) =>
      request
        .post(`/clients/${clientId}/shopping-carts/current/product-items`)
        .send(productItem);

    void it('should confirm', () =>
      given(openedShoppingCartWithProduct)
        .when((request) =>
          request.post(`/clients/${clientId}/shopping-carts/current/confirm`),
        )
        .then([expectResponse(204)]));

    void it('returns details', () =>
      given(openedShoppingCartWithProduct)
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
                  quantity: productItem.quantity,
                  productId: productItem.productId,
                },
              ],
              status: ShoppingCartStatus.Opened,
            },
          }),
        ]));
  });

  const now = new Date();

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: unitPrice,
      quantity: Math.random() * 10,
    };
  };

  const productItem = getRandomProduct();
});

// #endregion getting-started-e2e-tests
