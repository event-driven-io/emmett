import { DeciderSpecification } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { decide } from './businessLogic';
import { evolve, initialState, type PricedProductItem } from './shoppingCart';

const given = DeciderSpecification.for({
  decide,
  evolve,
  initialState: initialState,
});

void describe('ShoppingCart', () => {
  void describe('When empty', () => {
    void it('should add product item', () => {
      given([])
        .when({
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              productItem,
              addedAt: now,
            },
          },
        ]);
    });
  });

  void describe('When opened', () => {
    void it('should confirm', () => {
      given({
        type: 'ProductItemAddedToShoppingCart',
        data: {
          shoppingCartId,
          productItem,
          addedAt: oldTime,
        },
      })
        .when({
          type: 'ConfirmShoppingCart',
          data: {
            shoppingCartId,
          },
          metadata: { now },
        })
        .then([
          {
            type: 'ShoppingCartConfirmed',
            data: {
              shoppingCartId,
              confirmedAt: now,
            },
          },
        ]);
    });
  });

  void describe('When confirmed', () => {
    void it('should not add products', () => {
      given([
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
      ])
        .when({
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            productItem,
          },
          metadata: { now },
        })
        .thenThrows(
          (error: Error) => error.message === 'Shopping Cart already closed',
        );
    });
  });

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: Math.random() * 10,
      quantity: Math.random() * 10,
    };
  };
  const oldTime = new Date();
  const now = new Date();
  const shoppingCartId = randomUUID();

  const productItem = getRandomProduct();
});
