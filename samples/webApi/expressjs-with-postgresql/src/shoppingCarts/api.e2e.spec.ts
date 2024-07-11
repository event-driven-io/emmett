import {
  getInMemoryMessageBus,
  type EventStore,
} from '@event-driven-io/emmett';
import {
  ApiE2ESpecification,
  expectResponse,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { shoppingCartApi } from './api';
import { type PricedProductItem } from './shoppingCart';
import {
  getPostgreSQLEventStore,
  getPool,
  endAllPools,
} from '@event-driven-io/emmett-postgresql';

const getUnitPrice = () => {
  return Promise.resolve(100);
};

void describe('ShoppingCart E2E', () => {
  let clientId: string;
  let shoppingCartId: string;
  let postgres: StartedPostgreSqlContainer;
  let given: ApiE2ESpecification;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    const inMemoryMessageBus = getInMemoryMessageBus();

    given = ApiE2ESpecification.for(
      (): EventStore =>
        getPostgreSQLEventStore(getPool(postgres.getConnectionUri())),
      (eventStore: EventStore) =>
        getApplication({
          apis: [
            shoppingCartApi(
              eventStore,
              inMemoryMessageBus,
              getUnitPrice,
              () => now,
            ),
          ],
        }),
    );
  });

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  after(() => {
    return endAllPools();
  });

  void describe('When empty', () => {
    void it('should add product item', () => {
      return given((request) =>
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      )
        .when((request) =>
          request.get(`/clients/${clientId}/shopping-carts/current`).send(),
        )
        .then([
          expectResponse(200, {
            body: {
              clientId,
              id: shoppingCartId,
              productItems: [
                {
                  quantity: productItem.quantity,
                  productId: productItem.productId,
                },
              ],
              status: 'Opened',
            },
          }),
        ]);
    });
  });

  const now = new Date();

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: 100,
      quantity: Math.random() * 10,
    };
  };

  const productItem = getRandomProduct();
});
