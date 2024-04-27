import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiSpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import type { PricedProductItem, ShoppingCartEvent } from '../events';
import { shoppingCartApi } from './simpleApi';

const clientId = randomUUID();
const shoppingCartId = `shopping_cart:${clientId}:current`;
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

// #region test
import {
  existingStream,
  expectNewEvents,
  expectResponse,
} from '@event-driven-io/emmett-expressjs';

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
// #endregion test
