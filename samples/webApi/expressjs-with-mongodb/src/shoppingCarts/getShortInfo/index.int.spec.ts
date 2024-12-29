import {
  documentExists,
  PostgreSQLProjectionSpec,
} from '@event-driven-io/emmett-postgresql';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  shoppingCartShortInfoCollectionName,
  shoppingCartShortInfoProjection,
  type ShoppingCartShortInfo,
} from '.';
import { getShoppingCartId } from '../api';
import type { ShoppingCartEvent } from '../shoppingCart';

void describe('Shopping Cart Short Info Projection', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<ShoppingCartEvent>;
  let shoppingCartId: string;
  let clientId: string;
  const now = new Date();

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
  });

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = getShoppingCartId(clientId);
  });

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('adds product to empty shopping cart', () =>
    given([])
      .when([
        {
          type: 'ProductItemAddedToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem: { unitPrice: 100, productId: 'shoes', quantity: 100 },
            addedAt: now,
          },
          metadata: {
            streamName: shoppingCartId,
            clientId,
          },
        },
      ])
      .then(
        documentExists<ShoppingCartShortInfo>(
          {
            productItemsCount: 100,
            totalAmount: 10000,
          },
          {
            inCollection: shoppingCartShortInfoCollectionName,
            withId: shoppingCartId,
          },
        ),
      ));
});
