import { singleOrNull, SQL, type SQLExecutor } from '@event-driven-io/dumbo';
import { sqliteRawSQLProjection } from '@event-driven-io/emmett-sqlite';
import {
  type PricedProductItem,
  type ShoppingCartEvent,
} from '../shoppingCart';

export type ShoppingCartDetails = {
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
};

export const shoppingCartDetailsTableName = 'shoppingCartDetails';
export const shoppingCartDetailsProductItemsTableName =
  'shoppingCartDetailProductItems';

const initSQL = [
  SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(shoppingCartDetailsTableName)}
  (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    productItemsCount INTEGER,
    totalAmount INTEGER,
    status TEXT,
    openedAt DATETIME,
    confirmedAt DATETIME,
    cancelledAt DATETIME
  );`,
  SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(shoppingCartDetailsProductItemsTableName)}
  (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shoppingCartId TEXT,
    productId TEXT,
    quantity INTEGER,
    unitPrice INTEGER,
    FOREIGN KEY(shoppingCartId) REFERENCES ${SQL.identifier(shoppingCartDetailsTableName)}(id) ON DELETE CASCADE
  );
`,
];

export const getDetailsById = async (
  execute: SQLExecutor,
  shoppingCartId: string,
): Promise<ShoppingCartDetails | null> => {
  const details = await singleOrNull(
    execute.query<ShoppingCartDetails>(
      SQL`SELECT * FROM ${SQL.identifier(shoppingCartDetailsTableName)} WHERE id = ${shoppingCartId}`,
    ),
  );
  if (!details) {
    return null;
  }

  const result = await execute.query<PricedProductItem>(
    SQL`SELECT productId, quantity, unitPrice FROM ${SQL.identifier(shoppingCartDetailsProductItemsTableName)} WHERE shoppingCartId = ${shoppingCartId}`,
  );
  details.openedAt = new Date(details.openedAt);
  details.confirmedAt = details.confirmedAt
    ? new Date(details.confirmedAt)
    : undefined;
  details.cancelledAt = details.cancelledAt
    ? new Date(details.cancelledAt)
    : undefined;
  details.productItems = result.rows;

  return details;
};

const evolve = ({
  type,
  data: event,
  metadata: { clientId },
}: ShoppingCartEvent): SQL | SQL[] => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      const multiplier = type === 'ProductItemAddedToShoppingCart' ? 1 : -1;
      const productItemsCount = multiplier * event.productItem.quantity;
      const totalAmount =
        event.productItem.unitPrice * event.productItem.quantity;

      const sql = [
        SQL`
          INSERT INTO 
          ${SQL.identifier(shoppingCartDetailsTableName)} 
          (
            id, 
            clientId,
            productItemsCount, 
            totalAmount,
            status,
            openedAt
          ) VALUES (
            ${event.shoppingCartId}, 
            ${clientId},
            ${productItemsCount}, 
            ${totalAmount},
            'Opened',
            ${type === 'ProductItemAddedToShoppingCart' ? event.addedAt : new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`,
        SQL`INSERT INTO 
          ${SQL.identifier(shoppingCartDetailsProductItemsTableName)} 
          (
            shoppingCartId, 
            productId,
            quantity, 
            unitPrice
          ) VALUES (
            ${event.shoppingCartId}, 
            ${event.productItem.productId},
            ${productItemsCount}, 
            ${event.productItem.unitPrice}
          )
          ON CONFLICT (id) DO UPDATE SET
            quantity = quantity + ${productItemsCount},
            unitPrice = ${event.productItem.unitPrice};
          `,
        SQL`
          DELETE FROM ${SQL.identifier(shoppingCartDetailsProductItemsTableName)} WHERE 
            quantity <= 0 AND shoppingCartId = ${event.shoppingCartId} AND productId = ${event.productItem.productId};
            `,
      ];

      return sql;
    }
    case 'ShoppingCartConfirmed': {
      const sql = SQL`
      UPDATE ${SQL.identifier(shoppingCartDetailsTableName)} 
      SET status = "Confirmed", confirmedAt = ${new Date()} 
      WHERE id = ${event.shoppingCartId};`;

      return sql;
    }
    case 'ShoppingCartCancelled': {
      const sql = SQL`
      UPDATE ${SQL.identifier(shoppingCartDetailsTableName)} 
      SET status = "Cancelled", cancelledAt = ${new Date()} 
      WHERE id = ${event.shoppingCartId};`;

      return sql;
    }
  }
};

export const shoppingCartDetailsProjection =
  sqliteRawSQLProjection<ShoppingCartEvent>({
    name: 'shoppingCartDetails',
    evolve,
    canHandle: [
      'ProductItemAddedToShoppingCart',
      'ProductItemRemovedFromShoppingCart',
      'ShoppingCartConfirmed',
      'ShoppingCartCancelled',
    ],
    init: () => initSQL,
  });
