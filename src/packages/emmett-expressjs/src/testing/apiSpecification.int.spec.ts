import {
  getInMemoryEventStore,
  type EventStore,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { getApplication, HeaderNames, toWeakETag } from '..';
import { shoppingCartApi } from '../e2e/decider/api';
import type {
  PricedProductItem,
  ProductItem,
  ShoppingCartEvent,
} from '../e2e/decider/shoppingCart';
import {
  ApiSpecification,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
} from './apiSpecification';

void describe('ShoppingCart', () => {
  let clientId: string;
  let shoppingCartId: string;

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  void describe('When empty', () => {
    void it('should open shopping cart', () => {
      return given()
        .when((request) => {
          return request
            .post(`/clients/${clientId}/shopping-carts/`)
            .send(productItem);
        })
        .then([expectResponse(201)]);
    });

    void it('should NOT add product item', () => {
      return given()
        .when((request) => {
          return request
            .post(
              `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
            )
            .set(HeaderNames.IF_MATCH, toWeakETag(0))
            .send(productItem);
        })
        .then([expectResponse(403)]);
    });
  });

  void describe('When opened with product item', () => {
    void it('should confirm', () => {
      return given(
        existingStream<ShoppingCartEvent>(shoppingCartId, [
          {
            type: 'ShoppingCartOpened',
            data: { shoppingCartId, clientId, openedAt: oldTime },
          },
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              productItem: pricedProductItem,
            },
          },
        ]),
      )
        .when((request) =>
          request
            .post(
              `/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`,
            )
            .set(HeaderNames.IF_MATCH, toWeakETag(2)),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartConfirmed',
              data: {
                shoppingCartId,
                confirmedAt: oldTime,
              },
            },
          ]),
        ]);
    });
  });

  void describe('When confirmed', () => {
    void it('should not add products', () => {
      return given(
        existingStream<ShoppingCartEvent>(shoppingCartId, [
          {
            type: 'ShoppingCartOpened',
            data: { shoppingCartId, clientId, openedAt: oldTime },
          },
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              productItem: pricedProductItem,
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
            .post(
              `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
            )
            .set(HeaderNames.IF_MATCH, toWeakETag(3))
            .send(productItem),
        )
        .then(
          expectError(403, {
            detail: 'CART_IS_ALREADY_CLOSED',
            status: 403,
            title: 'Forbidden',
            type: 'about:blank',
          }),
        );
    });
  });

  const oldTime = new Date();
  const unitPrice = Math.random() * 10;

  const given = ApiSpecification.for<
    ShoppingCartEvent,
    EventStore<ReadEventMetadataWithGlobalPosition>
  >(
    () => getInMemoryEventStore(),
    (eventStore) =>
      getApplication({
        apis: [shoppingCartApi(eventStore)],
      }),
  );

  const getRandomProduct = (): ProductItem => {
    return {
      productId: randomUUID(),
      quantity: Math.random() * 10,
    };
  };

  const productItem = getRandomProduct();
  const pricedProductItem: PricedProductItem = {
    ...productItem,
    unitPrice,
  };
});
