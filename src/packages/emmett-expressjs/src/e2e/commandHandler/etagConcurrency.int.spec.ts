import {
  assertEqual,
  assertOk,
  getInMemoryEventStore,
  type InMemoryEventStore,
} from '@event-driven-io/emmett';
import type { Application } from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, it } from 'vitest';
import { getApplication } from '../..';
import { HeaderNames, toWeakETag } from '../../etag';
import {
  expectNextRevisionInResponseEtag,
  type TestResponse,
} from '../testing';
import { shoppingCartApi } from './api';
import type { ShoppingCartEvent } from '../decider/shoppingCart';

void describe('CommandHandler with ETag optimistic concurrency', () => {
  let app: Application;
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = getInMemoryEventStore();
    app = getApplication({ apis: [shoppingCartApi(eventStore)] });
  });

  void it('accepts a write carrying the current ETag and rejects a stale one', async () => {
    const clientId = randomUUID();
    const shoppingCartId = clientId;

    // 1. Open the cart: the response carries the first version as a weak ETag
    const createResponse = (await request(app)
      .post(`/clients/${clientId}/shopping-carts/`)
      .send()
      .expect(201)) as unknown as TestResponse<{ id: string }>;

    const currentRevision = expectNextRevisionInResponseEtag(createResponse);

    // 2. Add an item with a matching If-Match: succeeds, returns the next ETag
    const addResponse = (await request(app)
      .post(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
      )
      .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision))
      .send({ productId: '123', quantity: 2 })
      .expect(204)) as unknown as TestResponse<unknown>;

    const nextRevision = expectNextRevisionInResponseEtag(addResponse);
    assertOk(nextRevision > currentRevision);

    // 3. Replay the now-stale If-Match: the version moved on, so it conflicts
    await request(app)
      .post(
        `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
      )
      .set(HeaderNames.IF_MATCH, toWeakETag(currentRevision))
      .send({ productId: '123', quantity: 2 })
      .expect(412);

    const result =
      await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);
    assertEqual(result.events.length, Number(nextRevision));
  });
});
