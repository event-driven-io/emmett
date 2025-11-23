import {
  sqliteRawSQLProjection,
  type SQLiteConnection,
} from '@event-driven-io/emmett-sqlite';
import type { ShoppingCartEvent } from '../shoppingCart';

export type ShoppingCartShortInfo = {
  id: string;
  productItemsCount: number;
  totalAmount: number;
};

export const shoppingCartShortInfoTableName = 'shoppingCartShortInfo';

export const initSQL = `
  CREATE TABLE IF NOT EXISTS ${shoppingCartShortInfoTableName}
  (
    id TEXT PRIMARY KEY,
    productItemsCount INTEGER,
    totalAmount INTEGER
  );
`;

export const getShortInfoById = (
  db: SQLiteConnection,
  shoppingCartId: string,
): Promise<ShoppingCartShortInfo | null> =>
  db.querySingle(
    `SELECT * FROM ${shoppingCartShortInfoTableName} WHERE id = ?;`,
    [shoppingCartId],
  );

const evolve = ({ type, data: event }: ShoppingCartEvent): string => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      const multiplier = type === 'ProductItemAddedToShoppingCart' ? 1 : -1;
      const productItemsCount = multiplier * event.productItem.quantity;
      const totalAmount =
        event.productItem.unitPrice * event.productItem.quantity;

      const sql = `INSERT INTO 
          ${shoppingCartShortInfoTableName} 
          (
            id, 
            productItemsCount, 
            totalAmount
          ) VALUES (
            "${event.shoppingCartId}", 
            "${productItemsCount}", 
            "${totalAmount}"
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`;

      return sql;
    }
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled': {
      const sql = `DELETE FROM ${shoppingCartShortInfoTableName} WHERE id = "${event.shoppingCartId}";`;

      return sql;
    }
  }
};

export const shoppingCartShortInfoProjection = sqliteRawSQLProjection({
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  initSQL,
});
