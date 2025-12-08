import {
  sqliteRawSQLProjection,
  type SQLiteConnection,
} from '@event-driven-io/emmett-sqlite';
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
  `CREATE TABLE IF NOT EXISTS ${shoppingCartDetailsTableName}
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
  `CREATE TABLE IF NOT EXISTS ${shoppingCartDetailsProductItemsTableName}
  (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shoppingCartId TEXT,
    productId TEXT,
    quantity INTEGER,
    unitPrice INTEGER,
    FOREIGN KEY(shoppingCartId) REFERENCES ${shoppingCartDetailsTableName}(id) ON DELETE CASCADE
  );
`,
];

export const getDetailsById = async (
  db: SQLiteConnection,
  shoppingCartId: string,
): Promise<ShoppingCartDetails | null> => {
  const details = await db.querySingle<ShoppingCartDetails>(
    `SELECT * FROM ${shoppingCartDetailsTableName} WHERE id = ?`,
    [shoppingCartId],
  );
  if (!details) {
    return null;
  }

  const productItems = await db.query<PricedProductItem>(
    `SELECT productId, quantity, unitPrice FROM ${shoppingCartDetailsProductItemsTableName} WHERE shoppingCartId = ?`,
    [shoppingCartId],
  );
  details.openedAt = new Date(details.openedAt);
  details.confirmedAt = details.confirmedAt
    ? new Date(details.confirmedAt)
    : undefined;
  details.cancelledAt = details.cancelledAt
    ? new Date(details.cancelledAt)
    : undefined;
  details.productItems = productItems;

  return details;
};

const evolve = ({
  type,
  data: event,
  metadata: { clientId },
}: ShoppingCartEvent): string | string[] => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart':
    case 'ProductItemRemovedFromShoppingCart': {
      const multiplier = type === 'ProductItemAddedToShoppingCart' ? 1 : -1;
      const productItemsCount = multiplier * event.productItem.quantity;
      const totalAmount =
        event.productItem.unitPrice * event.productItem.quantity;

      const sql = [
        `INSERT INTO 
          ${shoppingCartDetailsProductItemsTableName} 
          (
            shoppingCartId, 
            productId,
            quantity, 
            unitPrice
          ) VALUES (
            '${event.shoppingCartId}', 
            '${event.productItem.productId}',
            '${productItemsCount}', 
            '${event.productItem.unitPrice}'
          )
          ON CONFLICT (id) DO UPDATE SET
            quantity = quantity + ${productItemsCount},
            unitPrice = ${event.productItem.unitPrice};
          `,
        `
          DELETE FROM ${shoppingCartDetailsProductItemsTableName} WHERE 
            quantity <= 0 AND shoppingCartId = "${event.shoppingCartId}" AND productId = "${event.productItem.productId}";
            `,
        `
          INSERT INTO 
          ${shoppingCartDetailsTableName} 
          (
            id, 
            clientId,
            productItemsCount, 
            totalAmount,
            status,
            openedAt
          ) VALUES (
            '${event.shoppingCartId}', 
            '${clientId}',
            '${productItemsCount}', 
            '${totalAmount}',
            'Opened',
            ${type === 'ProductItemAddedToShoppingCart' ? `"${event.addedAt.toISOString()}"` : Date.now()}
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`,
      ];

      return sql;
    }
    case 'ShoppingCartConfirmed': {
      const sql = `
      UPDATE ${shoppingCartDetailsTableName} 
      SET status = "Confirmed", confirmedAt = ${Date.now()} 
      WHERE id = "${event.shoppingCartId}";`;

      return sql;
    }
    case 'ShoppingCartCancelled': {
      const sql = `
      UPDATE ${shoppingCartDetailsTableName} 
      SET status = "Cancelled", cancelledAt = ${Date.now()} 
      WHERE id = "${event.shoppingCartId}";`;

      return sql;
    }
  }
};

export const shoppingCartDetailsProjection = sqliteRawSQLProjection({
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
  initSQL,
});
