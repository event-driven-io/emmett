import { beforeEach, describe, it } from 'node:test';
import type { PricedProductItem, ShoppingCartEvent } from '../events';
import { shoppingCartApi } from './simpleApi';
// #region getting-started-integration-tests
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';

void describe('ShoppingCart', () => {
  let clientId: string;
  let shoppingCartId: string;

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  void describe('When empty', () => {
    void it('should add product item', () => {
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

  void describe('When opened with product item', () => {
    void it('should confirm', () => {
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
          expectResponse(204),
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

  void describe('When confirmed', () => {
    void it('should not add products', () => {
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

  const oldTime = new Date();
  const now = new Date();
  const unitPrice = Math.random() * 10;

  const given = ApiSpecification.for<ShoppingCartEvent>(
    (): EventStore => getInMemoryEventStore(),
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
});

// #endregion getting-started-integration-tests
