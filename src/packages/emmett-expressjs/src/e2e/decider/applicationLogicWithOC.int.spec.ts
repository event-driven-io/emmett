import {
  assertEqual,
  assertFails,
  assertMatches,
  assertOk,
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import { type Application } from 'express';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { getApplication } from '../..';
import { HeaderNames, toWeakETag } from '../../etag';
import {
  expectNextRevisionInResponseEtag,
  runTwice,
  statuses,
  type TestResponse,
} from '../testing';
import { shoppingCartApi } from './api';
import { ShoppingCartErrors } from './businessLogic';
import type { ShoppingCartEvent } from './shoppingCart';

void describe('Application logic with optimistic concurrency', () => {
  let app: Application;
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
    const createResponse = (await runTwice(() =>
      request(app).post(`/clients/${clientId}/shopping-carts`).send(),
    ).expect(statuses(201, 412))) as TestResponse<{ id: string }>;

    let currentRevision = expectNextRevisionInResponseEtag(createResponse);
    const current = createResponse.body;

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
      request(app)
        .post(
          `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
        )
        .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision))
        .send(twoPairsOfShoes),
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
      request(app)
        .post(
          `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
        )
        .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision))
        .send(tShirt),
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
      request(app)
        .delete(
          `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
        )
        .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision)),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 5. Confirm cart
    ///////////////////////////////////////////////////

    response = await runTwice(() =>
      request(app)
        .post(`/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`)
        .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision)),
    ).expect(statuses(204, 412));

    currentRevision = expectNextRevisionInResponseEtag(response);

    ///////////////////////////////////////////////////
    // 6. Try Cancel Cart
    ///////////////////////////////////////////////////

    response = await request(app)
      .delete(`/clients/${clientId}/shopping-carts/${shoppingCartId}`)
      .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision))
      .expect((response) => {
        assertEqual(response.statusCode, 403);
        assertMatches(response.body, {
          detail: ShoppingCartErrors.CART_IS_ALREADY_CLOSED,
        });
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
