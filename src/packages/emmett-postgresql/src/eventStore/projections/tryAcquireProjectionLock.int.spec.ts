import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, describe } from 'node:test';

void describe('tryAcquireProjectionLock', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let pool: Dumbo;

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();
    pool = dumbo({ connectionString });
  });

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });
});
