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
  shoppingCartDetailsCollectionName,
  shoppingCartDetailsProjection,
  type ShoppingCartDetails,
} from '.';
import { getShoppingCartId } from '../api';
import type { ShoppingCartEvent } from '../shoppingCart';

void describe('Shopping Cart Short Details Projection', () => {
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
      projection: shoppingCartDetailsProjection,
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

  void it.skip('adds product to empty shopping cart', () =>
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
        documentExists<ShoppingCartDetails>(
          {
            status: 'Opened',
            clientId,
            openedAt: now,
            totalAmount: 10000,
            productItems: [
              { quantity: 100, productId: 'shoes', unitPrice: 100 },
            ],
            productItemsCount: 100,
          },
          {
            inCollection: shoppingCartDetailsCollectionName,
            withId: shoppingCartId,
          },
        ),
      ));
});
