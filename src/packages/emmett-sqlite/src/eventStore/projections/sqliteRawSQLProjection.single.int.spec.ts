import { single, SQL, type QueryResultRow } from '@event-driven-io/dumbo';
import {
  InMemorySQLiteDatabase,
  type AnySQLiteConnection,
} from '@event-driven-io/dumbo/sqlite3';
import { assertDeepEqual, JSONParser } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { beforeEach, describe, it } from 'vitest';
import { sqlite3EventStoreDriver } from '../../sqlite3';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../testing/shoppingCart.domain';
import { sqliteRawSQLProjection } from './sqliteProjection';
import {
  eventInStream,
  eventsInStream,
  newEventsInStream,
  SQLiteProjectionSpec,
} from './sqliteProjectionSpec';
const { identifier } = SQL;

type EventType =
  | (ProductItemAdded & {
      metadata: { streamName: string };
    })
  | (DiscountApplied & {
      metadata: { streamName: string };
    });

const projection = 'shoppingCartShortInfo';

void describe('SQLite Projections', () => {
  let given: SQLiteProjectionSpec<EventType>;
  let shoppingCartId: string;

  beforeEach(() => {
    shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`;

    given = SQLiteProjectionSpec.for({
      driver: sqlite3EventStoreDriver,
      projection: shoppingCartShortInfoProjection,
      fileName: InMemorySQLiteDatabase,
    });
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
const rowExistsWithValues = async <T extends QueryResultRow>({
  connection: { execute },
  id,
  data,
}: {
  connection: AnySQLiteConnection;
  id: string;
  data: T;
}): Promise<boolean> => {
  const res = await single(
    execute.query<T>(
      SQL`SELECT * FROM ${identifier(projection)} WHERE id = ${id}`,
    ),
  );

  assertDeepEqual(data, res);

  return true;
};

const rowExists = async <T extends QueryResultRow>({
  connection: { execute },
  id,
}: {
  connection: AnySQLiteConnection;
  id: string;
}): Promise<boolean> => {
  const res = await single(
    execute.query<T>(
      SQL`SELECT * FROM ${identifier(projection)} WHERE id = ${id}`,
    ),
  );

  if (res == null) return false;

  return true;
};

const shoppingCartShortInfoProjection = sqliteRawSQLProjection({
  evolve: (event: EventType): SQL => {
    switch (event.type) {
      case 'ProductItemAdded': {
        const productItemsCount = event.data.productItem.quantity;
        const totalAmount =
          event.data.productItem.price * event.data.productItem.quantity;

        const sql = SQL`INSERT INTO 
          ${identifier(projection)} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            ${event.metadata.streamName}, 
            ${productItemsCount}, 
            ${totalAmount}, 
            "[]"
          )
          ON CONFLICT (id) DO UPDATE SET
            productItemsCount = productItemsCount + ${productItemsCount},
            totalAmount = totalAmount + ${totalAmount};`;

        return sql;
      }
      case 'DiscountApplied': {
        const sql = SQL`INSERT INTO 
          ${identifier(projection)} 
          (
            id, 
            productItemsCount, 
            totalAmount, 
            discountsApplied
          ) VALUES (
            ${event.metadata.streamName}, 
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
                  ${event.data.couponId})
             WHERE json_array_length(discountsApplied) = 0 
                  OR NOT EXISTS (
                    SELECT 1 FROM json_each(discountsApplied) 
                    WHERE json_each.value = ${event.data.couponId}
                  )`;

        return sql;
      }
      default:
        throw new Error(
          `Unknown event type for ${shoppingCartShortInfoProjection.name}`,
        );
    }
  },
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initSQL: SQL`CREATE TABLE IF NOT EXISTS ${identifier(projection)}
        (
          id TEXT PRIMARY KEY,
          productItemsCount INTEGER,
          totalAmount INTEGER,
          discountsApplied JSON
        );
      `,
});
