import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'vitest';
import { getApplication, HeaderNames, toWeakETag } from '..';
import { shoppingCartApi } from '../e2e/decider/api';
import type { ProductItem } from '../e2e/decider/shoppingCart';
import { ApiE2ESpecification } from './apiE2ESpecification';
import { expectError, expectResponse } from './apiSpecification';

void describe('ApiE2ESpecification', () => {
  const testCases = [
    {
      name: 'New API',
      given: ApiE2ESpecification.for(() => {
        const eventStore = getInMemoryEventStore();
        return getApplication({
          apis: [shoppingCartApi(eventStore)],
        });
      }),
    },
    {
      name: 'Obsolete API',
      given: ApiE2ESpecification.for({
        getEventStore: () => getInMemoryEventStore(),
        getApplication: (eventStore) =>
          getApplication({
            apis: [shoppingCartApi(eventStore)],
          }),
      }),
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
