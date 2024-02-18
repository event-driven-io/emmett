import {
  getInMemoryEventStore,
  type EventStore,
} from '@event-driven-io/emmett';
import { type Application } from 'express';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { getApplication } from '..';
import { HeaderNames, toWeakETag } from '../etag';
import { mapShoppingCartStreamId, shoppingCartApi } from './api';
import { ShoppingCartErrors } from './businessLogic';
import type { ShoppingCartEvent } from './shoppingCart';
import {
  expectNextRevisionInResponseEtag,
  runTwice,
  statuses,
  type TestResponse,
} from './testing';

describe('Application logic with optimistic concurrency', () => {
  let app: Application;
  let eventStore: EventStore;

  beforeAll(() => {
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
      expect(false).toBeTruthy();
      return;
    }
    expect(current.id).toBeDefined();

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
        expect(response.statusCode).toBe(500);
        expect(response.body).toMatchObject({
          detail: ShoppingCartErrors.CART_IS_ALREADY_CLOSED,
        });
      });

    const result = await eventStore.readStream<ShoppingCartEvent>(
      mapShoppingCartStreamId(shoppingCartId),
    );

    expect(result).toBeDefined();
    expect(result!.events.length).toBe(Number(currentRevision));

    expect(result?.events).toMatchObject([
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
