import { type EventStore } from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { PricedProductItem } from '../events';
import { shoppingCartApi } from './simpleApi';

let esdbContainer: StartedEventStoreDBContainer;
const clientId = randomUUID();
const now = new Date();
const unitPrice = Math.random() * 10;

const given = ApiE2ESpecification.for(
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
  void it('should confirm', () => {
    return given((request) =>
      request
        .post(`/clients/${clientId}/shopping-carts/current/product-items`)
        .send(productItem),
    )
      .when((request) =>
        request.post(`/clients/${clientId}/shopping-carts/current/confirm`),
      )
      .then([expectResponse(204)]);
  });
});
// #endregion test
