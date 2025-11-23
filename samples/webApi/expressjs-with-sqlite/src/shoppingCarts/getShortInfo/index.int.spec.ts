import { assertDeepEqual } from '@event-driven-io/emmett';
import { SQLiteProjectionSpec } from '@event-driven-io/emmett-sqlite';
import { beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import { getShortInfoById, shoppingCartShortInfoProjection } from '.';
import { getShoppingCartId } from '../api';
import type { ShoppingCartEvent } from '../shoppingCart';

void describe('Shopping Cart Short Info Projection', () => {
  let given: SQLiteProjectionSpec<ShoppingCartEvent>;
  let shoppingCartId: string;
  let clientId: string;
  const now = new Date();

  beforeEach(() => {
    clientId = uuid();
    shoppingCartId = getShoppingCartId(clientId);

    given = SQLiteProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
    });
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
        const result = await getShortInfoById(connection, shoppingCartId);
        assertDeepEqual(result, {
          id: shoppingCartId,
          productItemsCount: 100,
          totalAmount: 10000,
        });
      }));
});
