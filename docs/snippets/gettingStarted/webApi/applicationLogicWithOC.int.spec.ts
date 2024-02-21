/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  assertMatches,
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  HeaderNames,
  getApplication,
  toWeakETag,
} from '@event-driven-io/emmett-expressjs';

import { type Application } from 'express';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import {
  expectNextRevisionInResponseEtag,
  runTwice,
  statuses,
  type TestResponse,
} from '../../../../packages/emmett-expressjs/src/e2e/testing';
import { shoppingCartApi } from './api';
import type { ShoppingCartEvent } from './shoppingCart';

describe('Application logic with optimistic concurrency', () => {
  let app: Application;
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
    app = getApplication({ apis: [shoppingCartApi(eventStore)] });
  });

  it('Should handle requests correctly', async () => {
    const clientId = uuid();
    ///////////////////////////////////////////////////
    // 1. Open Shopping Cart
    ///////////////////////////////////////////////////
    const createResponse = (await runTwice(() =>
      request(app).post(`/clients/${clientId}/shopping-carts`).send(),
    ).expect(statuses(201, 412))) as TestResponse<{ id: string }>;

    let currentRevision = expectNextRevisionInResponseEtag(createResponse);
    const current = createResponse.body;

    if (!current.id) {
      assert.fail();
      return;
    }
    assert.ok(current.id);

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
        assert.equal(response.statusCode, 403);
      });

    const result =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

    assert.ok(result);
    assert.equal(result.events.length, Number(currentRevision));

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
