import { AssertionError, getInMemoryEventStore } from '@event-driven-io/emmett';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'vitest';
import { getApplication, HeaderNames, toWeakETag } from '..';
import { shoppingCartApi } from '../e2e/decider/api';
import type { ProductItem } from '../e2e/decider/shoppingCart';
import { ApiE2ESpecification } from './apiE2ESpecification';
import { expectError, expectResponse } from './apiSpecification';

void describe('ApiE2ESpecification', () => {
  void it('uses worker fetch without requiring an event store', () => {
    let productItemsCount = 0;
    const worker = {
      fetch: (request: Request) => {
        if (request.method === 'POST') {
          productItemsCount++;
          return Promise.resolve(new Response(null, { status: 204 }));
        }

        return Promise.resolve(Response.json({ productItemsCount }));
      },
    };
    const given = ApiE2ESpecification.for({
      fetch: (request) => worker.fetch(request),
    });

    return given((request) => request.post('/product-items'))
      .when((request) => request.get('/shopping-cart'))
      .then([expectResponse(200, { body: { productItemsCount: 1 } })]);
  });

  void it('uses worker fetch with an explicit event store', () => {
    const eventStore = getInMemoryEventStore();
    const worker = {
      fetch: async (request: Request) => {
        if (request.method === 'POST') {
          await eventStore.appendToStream('stream-1', [
            { type: 'StreamStarted', data: {} },
          ]);
          return new Response(null, { status: 204 });
        }

        const { events } = await eventStore.readStream('stream-1');
        return Response.json({ eventsCount: events.length });
      },
    };
    const given = ApiE2ESpecification.for({
      getEventStore: () => eventStore,
      fetch: (request) => worker.fetch(request),
    });

    return given((request) => request.post('/events'))
      .when((request) => request.get('/'))
      .then([expectResponse(200, { body: { eventsCount: 1 } })]);
  });

  void it('uses an in-memory event store by default with an application', () => {
    const given = ApiE2ESpecification.for({
      getApplication: (eventStore) =>
        getApplication({
          apis: [shoppingCartApi(eventStore)],
        }),
    });
    const clientId = randomUUID();

    return given()
      .when((request) =>
        request
          .post(`/clients/${clientId}/shopping-carts/`)
          .send({ productId: 'product-1', quantity: 1 }),
      )
      .then([expectResponse(201)]);
  });

  void it('reports a false worker response assertion as an AssertionError', async () => {
    const given = ApiE2ESpecification.for({
      fetch: () => Response.json({ status: 'ok' }),
    });

    await assert.rejects(
      given()
        .when((request) => request.get('/health'))
        .then([() => Promise.resolve(false)]),
      AssertionError,
    );
  });

  // #region api-e2e-specification-setup
  const apiE2ESpecification = ApiE2ESpecification.for({
    getEventStore: () => getInMemoryEventStore(),
    getApplication: (eventStore) =>
      getApplication({
        apis: [shoppingCartApi(eventStore)],
      }),
  });
  // #endregion api-e2e-specification-setup

  // #region api-e2e-specification-example
  void it('prepares state through HTTP requests', () => {
    const clientId = 'client-123';
    const shoppingCartId = clientId;
    const productItem = { productId: 'product-123', quantity: 2 };

    return apiE2ESpecification(
      (request) => request.post(`/clients/${clientId}/shopping-carts/`).send(),
      (request) =>
        request
          .post(
            `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
          )
          .set(HeaderNames.IF_MATCH, toWeakETag(1))
          .send(productItem),
    )
      .when((request) =>
        request
          .post(`/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`)
          .set(HeaderNames.IF_MATCH, toWeakETag(2)),
      )
      .then([expectResponse(204, { headers: { etag: toWeakETag(3) } })]);
  });
  // #endregion api-e2e-specification-example

  const testCases = [
    {
      name: 'Options API',
      given: apiE2ESpecification,
    },
    {
      name: 'Obsolete Two-Arg API',
      given: ApiE2ESpecification.for(
        () => getInMemoryEventStore(),
        (eventStore) =>
          getApplication({
            apis: [shoppingCartApi(eventStore)],
          }),
      ),
    },
  ];

  for (const { name, given } of testCases) {
    void describe(`ApiE2ESpecification ${name} - Shopping Cart`, () => {
      let clientId: string;

      beforeEach(() => {
        clientId = randomUUID();
      });

      void describe('When empty', () => {
        void it('should open shopping cart', () => {
          return given()
            .when((request) =>
              request
                .post(`/clients/${clientId}/shopping-carts/`)
                .send(productItem),
            )
            .then([expectResponse(201)]);
        });

        void it('should NOT add product item', () => {
          return given()
            .when((request) =>
              request
                .post(
                  `/clients/${clientId}/shopping-carts/${clientId}/product-items`,
                )
                .set(HeaderNames.IF_MATCH, toWeakETag(0))
                .send(productItem),
            )
            .then([expectResponse(403)]);
        });
      });

      void describe('When opened with product item', () => {
        void it('should confirm', () => {
          return given(
            (request) =>
              request
                .post(`/clients/${clientId}/shopping-carts/`)
                .send(productItem),
            (request) =>
              request
                .post(
                  `/clients/${clientId}/shopping-carts/${clientId}/product-items`,
                )
                .set(HeaderNames.IF_MATCH, toWeakETag(1))
                .send(productItem),
          )
            .when((request) =>
              request
                .post(`/clients/${clientId}/shopping-carts/${clientId}/confirm`)
                .set(HeaderNames.IF_MATCH, toWeakETag(2)),
            )
            .then([expectResponse(204)]);
        });
      });

      void describe('When confirmed', () => {
        void it('should not add products', () => {
          return given(
            (request) =>
              request
                .post(`/clients/${clientId}/shopping-carts/`)
                .send(productItem),
            (request) =>
              request
                .post(
                  `/clients/${clientId}/shopping-carts/${clientId}/product-items`,
                )
                .set(HeaderNames.IF_MATCH, toWeakETag(1))
                .send(productItem),
            (request) =>
              request
                .post(`/clients/${clientId}/shopping-carts/${clientId}/confirm`)
                .set(HeaderNames.IF_MATCH, toWeakETag(2)),
          )
            .when((request) =>
              request
                .post(
                  `/clients/${clientId}/shopping-carts/${clientId}/product-items`,
                )
                .set(HeaderNames.IF_MATCH, toWeakETag(3))
                .send(productItem),
            )
            .then([
              expectError(403, {
                detail: 'CART_IS_ALREADY_CLOSED',
                status: 403,
                title: 'Forbidden',
                type: 'about:blank',
              }),
            ]);
        });
      });

      const getRandomProduct = (): ProductItem => {
        return {
          productId: randomUUID(),
          quantity: Math.random() * 10,
        };
      };

      const productItem = getRandomProduct();
    });
  }
});
