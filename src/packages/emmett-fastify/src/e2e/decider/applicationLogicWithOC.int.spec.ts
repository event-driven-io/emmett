import {
  assertEqual,
  assertFails,
  assertMatches,
  assertOk,
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { getApplication } from '../..';
import { RegisterRoutes } from './api';
import { ShoppingCartErrors } from './businessLogic';
import type { ShoppingCartEvent } from './shoppingCart';

void describe('Application logic with optimistic concurrency using Fastify', () => {
  let app: FastifyInstance;
  let eventStore: EventStore;
  beforeEach(async () => {
    eventStore = getInMemoryEventStore();
    const registerRoutes = RegisterRoutes(eventStore);
    app = await getApplication({ registerRoutes });
  });

  void it('Should handle requests correctly', async () => {
    const clientId = randomUUID();
    ///////////////////////////////////////////////////
    // 1. Open Shopping Cart
    ///////////////////////////////////////////////////

    const createResponse = await app.inject({
      method: 'POST',
      url: `/clients/${clientId}/shopping-carts`,
    });

    const current = createResponse.json<{ id: string }>();
    if (!current?.id) {
      assertFails();
    }
    assertOk(current.id);

    const shoppingCartId = current.id;
    ///////////////////////////////////////////////////
    // 2. Add Two Pair of Shoes
    ///////////////////////////////////////////////////
    const twoPairsOfShoes = {
      quantity: 2,
      productId: '123',
    };
    let response = await app.inject({
      method: 'POST',
      url: `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
      body: twoPairsOfShoes,
    });
    assertEqual(response.statusCode, 204);

    ///////////////////////////////////////////////////
    // 3. Add T-Shirt
    ///////////////////////////////////////////////////
    const tShirt = {
      productId: '456',
      quantity: 1,
    };

    response = await app.inject({
      method: 'POST',
      url: `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
      body: tShirt,
    });

    assertEqual(response.statusCode, 204);

    ///////////////////////////////////////////////////
    // 4. Remove pair of shoes
    ///////////////////////////////////////////////////
    const pairOfShoes = {
      productId: '123',
      quantity: 1,
      unitPrice: 100,
    };

    response = await app.inject({
      method: 'DELETE',
      url: `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
    });
    assertEqual(response.statusCode, 204);

    ///////////////////////////////////////////////////
    // 5. Confirm cart
    ///////////////////////////////////////////////////

    response = await app.inject({
      method: 'POST',
      url: `/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`,
    });

    assertEqual(response.statusCode, 204);

    ///////////////////////////////////////////////////
    // 6. Try Cancel Cart
    ///////////////////////////////////////////////////
    response = await app.inject({
      method: 'DELETE',
      url: `/clients/${clientId}/shopping-carts/${shoppingCartId}`,
    });

    assertEqual(response.statusCode, 403);
    assertMatches(response.json(), {
      detail: ShoppingCartErrors.CART_IS_ALREADY_CLOSED,
    });
    const result =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertOk(result);
    assertEqual(result.events.length, Number(5));

    assertMatches(result?.events, [
      {
        type: 'ShoppingCartOpened',
        data: {
          shoppingCartId,
          clientId,
          //openedAt,
        },
      },
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
    ]);
  });
});
