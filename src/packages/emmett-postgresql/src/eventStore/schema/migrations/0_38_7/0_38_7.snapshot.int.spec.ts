import { dumbo, runSQLMigrations } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { migrations_0_38_7 } from '.';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '../../../postgreSQLEventStore';

void describe('0.38.7 schema', () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: PgPool;
  let eventStore: PostgresEventStore;
  let connectionString: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    await postgres.snapshot();
  });

  beforeEach(async () => {
    await postgres.restoreSnapshot();

    pool = dumbo({
      connectionString,
      driver: pgDumboDriver,
    });

    // TODO: Change setup to schemas, when they're supported in Emmett instead of using separate containers
    eventStore = getPostgreSQLEventStore(connectionString, {
      connectionOptions: { dumbo: pool },
      schema: { autoMigration: 'None' },
    });
  });

  afterEach(async () => {
    try {
      await eventStore.close();
      await pool.close();
    } catch (error) {
      console.log(error);
    }
  });

  afterAll(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  it('0.38.7 schema is unchanged', () => {
    const result = runSQLMigrations(pool, migrations_0_38_7, {
      dryRun: true,
    });
    expect(result).toMatchSnapshot();
  });
});
