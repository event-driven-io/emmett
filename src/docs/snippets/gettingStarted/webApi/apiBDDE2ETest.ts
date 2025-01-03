import {
  ApiE2ESpecification,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { PricedProductItem } from '../events';
import { shoppingCartApi } from './simpleApi';

const esdbContainer: StartedEventStoreDBContainer = undefined!;
const clientId = randomUUID();
const now = new Date();
const unitPrice = Math.random() * 10;

const given = ApiE2ESpecification.for(
  () => getEventStoreDBEventStore(esdbContainer.getClient()),
  (eventStore) =>
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

const getRandomProduct = (): PricedProductItem => {
  return {
    productId: randomUUID(),
    unitPrice,
    quantity: Math.random() * 10,
  };
};

const productItem = getRandomProduct();

// #region test
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import { expectResponse } from '@event-driven-io/emmett-expressjs';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';

void describe('When opened with product item', () => {
  const openedShoppingCartWithProduct: TestRequest = (request) =>
    request
      .post(`/clients/${clientId}/shopping-carts/current/product-items`)
      .send(productItem);

  void it('should confirm', () => {
    return given(openedShoppingCartWithProduct)
      .when((request) =>
        request.post(`/clients/${clientId}/shopping-carts/current/confirm`),
      )
      .then([expectResponse(204)]);
  });
});
// #endregion test
