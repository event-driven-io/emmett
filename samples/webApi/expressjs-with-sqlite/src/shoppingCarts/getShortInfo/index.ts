import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { sqliteRawSQLProjection } from '@event-driven-io/emmett-sqlite';
import type { ShoppingCartEvent } from '../shoppingCart';

export type ShoppingCartShortInfo = {
  id: string;
  productItemsCount: number;
  totalAmount: number;
};

export const shoppingCartShortInfoTableName = 'shoppingCartShortInfo';

export const initSQL = SQL`
  CREATE TABLE IF NOT EXISTS ${SQL.identifier(shoppingCartShortInfoTableName)}
  (
    id TEXT PRIMARY KEY,
    productItemsCount INTEGER,
    totalAmount INTEGER
  );
`;

export const getShortInfoById = (
  db: SQLExecutor,
  shoppingCartId: string,
): Promise<ShoppingCartShortInfo | null> =>
  singleOrNull(
    db.query(
      SQL`SELECT * FROM ${SQL.identifier(shoppingCartShortInfoTableName)} WHERE id = ${shoppingCartId};`,
    ),
  );

const evolve = ({ type, data: event }: ShoppingCartEvent): SQL => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      const multiplier = type === 'ProductItemAddedToShoppingCart' ? 1 : -1;
      const productItemsCount = multiplier * event.productItem.quantity;
      const totalAmount =
        event.productItem.unitPrice * event.productItem.quantity;

      const sql = SQL`INSERT INTO 
          ${SQL.identifier(shoppingCartShortInfoTableName)} 
          (
            id, 
            productItemsCount, 
            totalAmount
          ) VALUES (
            ${event.shoppingCartId}, 
            ${productItemsCount}, 
            ${totalAmount}
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`;

      return sql;
    }
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled': {
      const sql = SQL`DELETE FROM ${SQL.identifier(shoppingCartShortInfoTableName)} WHERE id = ${event.shoppingCartId};`;

      return sql;
    }
  }
};

export const shoppingCartShortInfoProjection = sqliteRawSQLProjection({
  name: 'shoppingCartShortInfo',
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  init: () => initSQL,
});
