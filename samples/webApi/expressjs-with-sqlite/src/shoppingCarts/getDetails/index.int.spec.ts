import {
  assertDeepEqual,
  assertEqual,
  assertIsNotNull,
} from '@event-driven-io/emmett';
import { SQLiteProjectionSpec } from '@event-driven-io/emmett-sqlite';
import { before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { getDetailsById, shoppingCartDetailsProjection } from '.';
import { getShoppingCartId } from '../api';
import type { ShoppingCartEvent } from '../shoppingCart';

void describe('Shopping Cart Short Details Projection', () => {
  let given: SQLiteProjectionSpec<ShoppingCartEvent>;
  let shoppingCartId: string;
  let clientId: string;
  const now = new Date();

  before(() => {
    given = SQLiteProjectionSpec.for({
      projection: shoppingCartDetailsProjection,
    });
  });

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = getShoppingCartId(clientId);
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
      .then(async ({ connection }) => {
        const result = await getDetailsById(connection, shoppingCartId);
        assertIsNotNull(result);

        const { openedAt, ...rest } = result;
        assertEqual(openedAt?.toISOString(), now.toISOString());
        assertDeepEqual(rest, {
          id: shoppingCartId,
          clientId,
          productItemsCount: 100,
          totalAmount: 10000,
          status: 'Opened',
          productItems: [{ productId: 'shoes', quantity: 100, unitPrice: 100 }],
          cancelledAt: undefined,
          confirmedAt: undefined,
        });
      }));
});
