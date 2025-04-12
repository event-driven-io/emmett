import { assertDeepEqual, JSONParser } from '@event-driven-io/emmett';
import fs from 'fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import { sqliteRawSQLProjection, type SQLiteProjectionHandlerContext } from '.';
import { sqliteConnection, type SQLiteConnection } from '../../connection';
import {
  type DiscountApplied,
  type ProductItemAdded,
} from '../../testing/shoppingCart.domain';
import {
  eventInStream,
  eventsInStream,
  newEventsInStream,
  SQLiteProjectionSpec,
} from './sqliteProjectionSpec';

type EventType =
  | (ProductItemAdded & {
      metadata: { streamName: string };
    })
  | (DiscountApplied & {
      metadata: { streamName: string };
    });

const projection = 'shoppingCartShortInfo';

const testDatabasePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
);
const fileName = path.resolve(testDatabasePath, 'testdb.db');

void describe('SQLite Projections', () => {
  let given: SQLiteProjectionSpec<EventType>;
  let connection: SQLiteConnection;
  let shoppingCartId: string;

  beforeEach(async () => {
    shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`;
    connection = sqliteConnection({ fileName: fileName });

    const streamsTableSQL = `CREATE TABLE IF NOT EXISTS ${projection}
        (
          id TEXT PRIMARY KEY,
          productItemsCount INTEGER,
          totalAmount INTEGER,
          discountsApplied JSON
        );
      `;

    await connection.command(streamsTableSQL);

    given = SQLiteProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connection: connection,
    });
  });

  afterEach(() => {
    if (!fs.existsSync(fileName)) {
      return;
    }
    fs.unlinkSync(fileName);
  });

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: {
              price: 100,
              productId: 'shoes',
              quantity: 100,
            },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        async ({ connection }) =>
          await rowExists({
            connection,
            id: shoppingCartId,
          }),
      ));

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        }),
      ])
      .then(
        async ({ connection }) =>
          await rowExistsWithValues({
            connection,
            id: shoppingCartId,
            data: {
              id: shoppingCartId,
              productItemsCount: 100,
              totalAmount: 10000,
              discountsApplied: JSONParser.stringify([]),
            },
          }),
      ));

  void it('with idempotency check', () => {
    const couponId = uuid();

    return given(
      eventsInStream(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: 10, couponId },
            metadata: {
              streamName: shoppingCartId,
            },
          },
        ]),
        { numberOfTimes: 2 },
      )
      .then(
        async ({ connection }) =>
          await rowExistsWithValues({
            connection,
            id: shoppingCartId,
            data: {
              id: shoppingCartId,
              productItemsCount: 100,
              totalAmount: 9000,
              discountsApplied: JSONParser.stringify([couponId]),
            },
          }),
      );
  });
});
const rowExistsWithValues = async <T>({
  connection,
  id,
  data,
}: {
  connection: SQLiteConnection;
  id: string;
  data: T;
}): Promise<boolean> => {
  const res = await connection.querySingle<T>(
    `SELECT * FROM ${projection} WHERE id = ?`,
    [id],
  );

  assertDeepEqual(data, res);

  return true;
};

const rowExists = async <T>({
  connection,
  id,
}: {
  connection: SQLiteConnection;
  id: string;
}): Promise<boolean> => {
  const res = await connection.querySingle<T>(
    `SELECT * FROM ${projection} WHERE id = ?`,
    [id],
  );

  if (res == null) return false;

  return true;
};

const shoppingCartShortInfoProjection = sqliteRawSQLProjection(
  (event: EventType, _context: SQLiteProjectionHandlerContext): string => {
    switch (event.type) {
      case 'ProductItemAdded': {
        const productItemsCount = event.data.productItem.quantity;
        const totalAmount =
          event.data.productItem.price * event.data.productItem.quantity;

        const sql = `INSERT INTO 
          ${projection} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            "${event.metadata.streamName}", 
            "${productItemsCount}", 
            "${totalAmount}", 
            "[]"
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`;

        return sql;
      }
      case 'DiscountApplied': {
        const sql = `INSERT INTO 
          ${projection} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            "${event.metadata.streamName}", 
            0, 
            0, 
            "[]"
          )
          ON CONFLICT (id) DO UPDATE SET
            totalAmount = (totalAmount * (100 - ${event.data.percent})) / 100,
             discountsApplied = 
               json_insert(
                  COALESCE(discountsApplied, '[]'),
                  '$[#]', 
                  '${event.data.couponId}')
             WHERE json_array_length(discountsApplied) = 0 
                  OR NOT EXISTS (
                    SELECT 1 FROM json_each(discountsApplied) 
                    WHERE json_each.value = '${event.data.couponId}'
                  )`;

        return sql;
      }
      default:
        throw new Error(
          `Unknown event type for ${shoppingCartShortInfoProjection.name}`,
        );
    }
  },
  'ProductItemAdded',
  'DiscountApplied',
);
