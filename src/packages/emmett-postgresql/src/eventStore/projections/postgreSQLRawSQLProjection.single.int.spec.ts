import { SQL } from '@event-driven-io/dumbo';
import { tableExists } from '@event-driven-io/dumbo/pg';
import { assertTrue, type Event } from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { postgreSQLRawSQLProjection } from './postgreSQLProjection';
import { expectSQL, PostgreSQLProjectionSpec } from './postgresProjectionSpec';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { price: number; productId: string; quantity: number } }
>;

void describe('PostgreSQL Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
  });

  afterAll(async () => {
    try {
      await postgres?.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should call init method', async () => {
    let wasInitCalled = false;

    const given = PostgreSQLProjectionSpec.for({
      connectionString,
      projection: postgreSQLRawSQLProjection({
        name: 'test',
        evolve: () => SQL`SELECT 1;`,
        canHandle: ['ProductItemAdded'],
        init: () => {
          wasInitCalled = true;
        },
      }),
    });

    await given([])
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
        },
      ])
      .then(async () => {
        if (!wasInitCalled) {
          throw new Error('Init was not called');
        }
        return Promise.resolve(true);
      });
  });

  void it('should call initSQL method', async () => {
    const projection = 'init_sql_projection';

    const given = PostgreSQLProjectionSpec.for({
      connectionString,
      projection: postgreSQLRawSQLProjection({
        name: 'test',
        evolve: () => SQL`SELECT 1;`,
        canHandle: ['ProductItemAdded'],
        init: () =>
          SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(projection)} (id TEXT)`,
      }),
    });

    await given([])
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
        },
      ])
      .then(async ({ pool }) => {
        const result = await tableExists(pool.execute, projection);

        assertTrue(result);
      });
  });

  void it('sums product sales into a table', () => {
    const productSales = 'product_sales';

    const given = PostgreSQLProjectionSpec.for({
      connectionString,
      projection: postgreSQLRawSQLProjection<ProductItemAdded>({
        name: 'productSales',
        canHandle: ['ProductItemAdded'],
        init: () =>
          SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(productSales)} (
            product_id TEXT PRIMARY KEY,
            total_amount INT NOT NULL
          )`,
        evolve: ({ data: { productItem } }) =>
          SQL`INSERT INTO ${SQL.identifier(productSales)} (product_id, total_amount)
              VALUES (${productItem.productId}, ${productItem.price * productItem.quantity})
              ON CONFLICT (product_id)
              DO UPDATE SET total_amount = ${SQL.identifier(productSales)}.total_amount + EXCLUDED.total_amount`,
      }),
    });

    return given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 2 },
          },
        },
      ])
      .then(
        expectSQL
          .query(
            SQL`SELECT product_id, total_amount FROM ${SQL.identifier(productSales)}`,
          )
          .resultRows.toBeTheSame([{ product_id: 'shoes', total_amount: 200 }]),
      );
  });
});
