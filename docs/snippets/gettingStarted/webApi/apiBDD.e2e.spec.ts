/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import type { PricedProductItem } from '../events';
import { ShoppingCartStatus } from './shoppingCart';
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  describe('When empty', () => {
    it('should add product item', () => {
      return given((request) =>
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      )
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
        ]);
    });
  });

  const now = new Date();

  const given = ApiE2ESpecification.for(
    (): EventStore => getInMemoryEventStore(),
    (eventStore: EventStore) =>
      getApplication({
        apis: [shoppingCartApi(eventStore, getUnitPrice, () => now)],
      }),
  );

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: 100,
      quantity: Math.random() * 10,
    };
  };

  const productItem = getRandomProduct();
});
