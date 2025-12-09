import {
  assertEqual,
  assertFails,
  assertMatches,
  assertOk,
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import { getApplication } from '../../application';
import { HeaderNames, toWeakETag } from '../../etag';
import {
  expectNextRevisionInResponseEtag,
  runTwice,
  statuses,
} from '../testing';
import { shoppingCartApi } from './api';
import { ShoppingCartErrors } from './businessLogic';
import type { ShoppingCartEvent } from './shoppingCart';

void describe('Application logic with optimistic concurrency', () => {
  let app: Hono;
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
    app = getApplication({ apis: [shoppingCartApi(eventStore)] });
  });

  void it('Should handle requests correctly', async () => {
    const clientId = randomUUID();
    ///////////////////////////////////////////////////
    // 1. Open Shopping Cart
    ///////////////////////////////////////////////////
    const createResponse = await runTwice(() =>
      app.request(`/clients/${clientId}/shopping-carts/`, { method: 'POST' }),
    ).expect(statuses(201, 412));

    let currentRevision = expectNextRevisionInResponseEtag(createResponse);
    const current = (await createResponse.json()) as { id?: string };

    if (!current.id) {
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
    let response = await runTwice(() =>
      app.request(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
        {
          method: 'POST',
          headers: new Headers({
            'Content-Type': 'application/json',
            [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
          }),
          body: JSON.stringify(twoPairsOfShoes),
        },
      ),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 3. Add T-Shirt
    ///////////////////////////////////////////////////
    const tShirt = {
      productId: '456',
      quantity: 1,
    };
    response = await runTwice(() =>
      app.request(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
        {
          method: 'POST',
          headers: new Headers({
            'Content-Type': 'application/json',
            [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
          }),
          body: JSON.stringify(tShirt),
        },
      ),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 4. Remove pair of shoes
    ///////////////////////////////////////////////////
    const pairOfShoes = {
      productId: '123',
      quantity: 1,
      unitPrice: 100,
    };
    response = await runTwice(() =>
      app.request(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
        {
          method: 'DELETE',
          headers: new Headers({
            [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
          }),
        },
      ),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 5. Confirm cart
    ///////////////////////////////////////////////////

    response = await runTwice(() =>
      app.request(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`,
        {
          method: 'POST',
          headers: new Headers({
            [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
          }),
        },
      ),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 6. Try Cancel Cart
    ///////////////////////////////////////////////////

    response = await app.request(
      `/clients/${clientId}/shopping-carts/${shoppingCartId}`,
      {
        method: 'DELETE',
        headers: new Headers({
          [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
        }),
      },
    );

    assertEqual(response.status, 403);
    const body = (await response.json()) as { detail?: string };
    assertMatches(body, {
      detail: ShoppingCartErrors.CART_IS_ALREADY_CLOSED,
    });

    const result =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assertOk(result);
    assertEqual(result.events.length, Number(currentRevision));

    assertMatches(result?.events, [
      {
        type: 'ShoppingCartOpened',
        data: {
          shoppingCartId,
          clientId,
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
        },
      },
    ]);
  });
});
