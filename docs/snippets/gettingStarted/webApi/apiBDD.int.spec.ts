/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiSpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import type { PricedProductItem, ShoppingCartEvent } from '../events';
import { shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

const given = ApiSpecification.for<ShoppingCartEvent>(
  () => getInMemoryEventStore(),
  (eventStore: EventStore) =>
    getApplication({ apis: [shoppingCartApi(eventStore, getUnitPrice)] }),
);

describe('ShoppingCart', () => {
  describe('When empty', () => {
    it('should add product item', () => {
      const clientId = uuid();
      return given([])
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([
          {
            streamName: shoppingCartId,
            events: [
              {
                type: 'ProductItemAddedToShoppingCart',
                data: {
                  shoppingCartId,
                  productItem,
                  addedAt: now,
                },
              },
            ],
          },
        ]);
    });
  });

  // describe('When opened', () => {
  //   it('should confirm', () => {
  //     given({
  //       type: 'ProductItemAddedToShoppingCart',
  //       data: {
  //         shoppingCartId,
  //         productItem,
  //         addedAt: oldTime,
  //       },
  //     })
  //       .when({
  //         type: 'AddProductItemToShoppingCart',
  //         data: {
  //           shoppingCartId,
  //           productItem,
  //         },
  //         metadata: { now },
  //       })
  //       .then([
  //         {
  //           type: 'ProductItemAddedToShoppingCart',
  //           data: {
  //             shoppingCartId,
  //             productItem,
  //             addedAt: now,
  //           },
  //         },
  //       ]);
  //   });
  // });

  // describe('When confirmed', () => {
  //   it('should not add products', () => {
  //     given([
  //       {
  //         type: 'ProductItemAddedToShoppingCart',
  //         data: {
  //           shoppingCartId,
  //           productItem,
  //           addedAt: oldTime,
  //         },
  //       },
  //       {
  //         type: 'ShoppingCartConfirmed',
  //         data: { shoppingCartId, confirmedAt: oldTime },
  //       },
  //     ])
  //       .when({
  //         type: 'AddProductItemToShoppingCart',
  //         data: {
  //           shoppingCartId,
  //           productItem,
  //         },
  //         metadata: { now },
  //       })
  //       .thenThrows(
  //         (error: Error) => error.message === 'Shopping Cart already closed',
  //       );
  //   });
  // });

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: uuid(),
      unitPrice: Math.random() * 10,
      quantity: Math.random() * 10,
    };
  };
  const oldTime = new Date();
  const now = new Date();
  const shoppingCartId = uuid();

  const productItem = getRandomProduct();
});
