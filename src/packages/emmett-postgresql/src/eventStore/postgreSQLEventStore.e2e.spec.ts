import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { describe } from 'node:test';
import pg from 'pg';
import {
  testAggregateStream,
  type EventStoreFactory,
} from '../../../emmett/src/testing/features';
import { getPool } from '../connections';
import { getPostgreSQLEventStore } from './postgreSQLEventStore';

void describe('EventStoreDBEventStore', async () => {
  let postgres: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  const eventStoreFactory: EventStoreFactory = async () => {
    postgres = await new PostgreSqlContainer().start();
    pool = getPool(postgres.getConnectionUri());
    return getPostgreSQLEventStore(pool);
  };

  const teardownHook = async () => {
    try {
      await pool.end();
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  };

  await testAggregateStream(eventStoreFactory, {
    teardownHook,
    getInitialIndex: () => 1n,
  });
});
