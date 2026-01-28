import { SQL } from '@event-driven-io/dumbo/.';
import { tableExists } from '@event-driven-io/dumbo/pg';
import { assertTrue } from '@event-driven-io/emmett';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { after, before, describe, it } from 'node:test';
import { postgreSQLRawSQLProjection } from './postgreSQLProjection';
import { PostgreSQLProjectionSpec } from './postgresProjectionSpec';

void describe('PostgreSQL Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;

  before(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();
  });

  after(async () => {
    try {
      await postgres.stop();
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
        const result = await tableExists(pool, projection);

        assertTrue(result);
      });
  });
});
