/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import type { PricedProductItem, ShoppingCartEvent } from '../events';
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

describe('ShoppingCart', () => {
  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });
  describe('When empty', () => {
    it('should add product item', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemAddedToShoppingCart',
              data: {
                shoppingCartId,
                productItem,
                addedAt: now,
              },
            },
          ]),
        ]);
    });
  });

  describe('When opened with product item', () => {
    it('should confirm', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              productItem,
              addedAt: oldTime,
            },
          },
        ]),
      )
        .when((request) =>
          request.post(`/clients/${clientId}/shopping-carts/current/confirm`),
        )
        .then([
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartConfirmed',
              data: {
                shoppingCartId,
                confirmedAt: now,
              },
            },
          ]),
        ]);
    });
  });

  describe('When confirmed', () => {
    it('should not add products', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              productItem,
              addedAt: oldTime,
            },
          },
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: oldTime },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then(
          expectError(403, {
            detail: 'Shopping Cart already closed',
            status: 403,
            title: 'Forbidden',
            type: 'about:blank',
          }),
        );
    });
  });

  let clientId: string;
  let shoppingCartId: string;

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: uuid(),
      unitPrice: 100,
      quantity: Math.random() * 10,
    };
  };
  const oldTime = new Date();

  const productItem = getRandomProduct();

  const now = new Date();

  const given = ApiSpecification.for<ShoppingCartEvent>(
    (): EventStore => getInMemoryEventStore(),
    (eventStore: EventStore) =>
      getApplication({
        apis: [shoppingCartApi(eventStore, getUnitPrice, () => now)],
      }),
  );
});
