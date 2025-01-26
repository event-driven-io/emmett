import {
  ApiE2ESpecification,
  getApplication,
  type TestRequest,
} from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { PricedProductItem } from '../events';
import { shoppingCartApi } from './simpleApi';

const postgreSQLContainer: StartedPostgreSqlContainer = undefined!;
const clientId = randomUUID();
const now = new Date();
const unitPrice = Math.random() * 10;

const given = ApiE2ESpecification.for(
  () => getPostgreSQLEventStore(postgreSQLContainer.getConnectionUri()),
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
import { expectResponse } from '@event-driven-io/emmett-expressjs';

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
