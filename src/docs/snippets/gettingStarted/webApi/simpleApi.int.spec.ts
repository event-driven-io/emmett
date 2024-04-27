import {
  assertMatches,
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { getApplication } from '@event-driven-io/emmett-expressjs';

import { type Application } from 'express';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import type { ShoppingCartEvent } from '../events';
import { getShoppingCartId, shoppingCartApi } from './simpleApi';

const getUnitPrice = (_productId: string) => {
  return Promise.resolve(100);
};

void describe('Simple Api from getting started', () => {
  let app: Application;
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
    app = getApplication({
      apis: [shoppingCartApi(eventStore, getUnitPrice, () => new Date())],
    });
  });

  void it('Should handle requests correctly', async () => {
    const clientId = randomUUID();
    ///////////////////////////////////////////////////
    // 1. Add Two Pair of Shoes
    ///////////////////////////////////////////////////
    const twoPairsOfShoes = {
      quantity: 2,
      productId: '123',
    };
    await request(app)
      .post(`/clients/${clientId}/shopping-carts/current/product-items`)
      .send(twoPairsOfShoes);
    ///////////////////////////////////////////////////
    // 2. Add T-Shirt
    ///////////////////////////////////////////////////
    const tShirt = {
      productId: '456',
      quantity: 1,
    };
    await request(app)
      .post(`/clients/${clientId}/shopping-carts/current/product-items`)
      .send(tShirt);

    ///////////////////////////////////////////////////
    // 3. Remove pair of shoes
    ///////////////////////////////////////////////////
    const pairOfShoes = {
      productId: '123',
      quantity: 1,
      unitPrice: 100,
    };
    await request(app).delete(
      `/clients/${clientId}/shopping-carts/current/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
    );

    ///////////////////////////////////////////////////
    // 4. Confirm cart
    ///////////////////////////////////////////////////

    await request(app).post(
      `/clients/${clientId}/shopping-carts/current/confirm`,
    );

    ///////////////////////////////////////////////////
    // 5. Try Cancel Cart
    ///////////////////////////////////////////////////

    await request(app)
      .delete(`/clients/${clientId}/shopping-carts/current`)
      .expect((response) => {
        assert.equal(response.statusCode, 403);
      });

    const shoppingCartId = getShoppingCartId(clientId);

    const result = await eventStore.readStream<ShoppingCartEvent>(
      getShoppingCartId(clientId),
    );

    assert.ok(result);
    assert.equal(result.events.length, 4);

    assertMatches(result?.events, [
      {
        type: 'ProductItemAddedToShoppingCart',
        data: {
          shoppingCartId,
          productItem: twoPairsOfShoes,
        },
      },
      {
        type: 'ProductItemAddedToShoppingCart',
        data: {
          shoppingCartId,
          productItem: tShirt,
        },
      },
      {
        type: 'ProductItemRemovedFromShoppingCart',
        data: { shoppingCartId, productItem: pairOfShoes },
      },
      {
        type: 'ShoppingCartConfirmed',
        data: {
          shoppingCartId,
          //confirmedAt,
        },
      },
      // This should fail
      // {
      //   type: 'ShoppingCartCanceled',
      //   data: {
      //     shoppingCartId,
      //     canceledAt,
      //   },
      // },
    ]);
  });
});
