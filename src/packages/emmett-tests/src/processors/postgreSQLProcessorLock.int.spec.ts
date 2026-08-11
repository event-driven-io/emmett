import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { defaultTag } from '@event-driven-io/emmett';
import {
  createEventStoreSchema,
  postgreSQLProcessorLock,
  type PostgreSQLProcessorLockContext,
} from '@event-driven-io/emmett-postgresql';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import {
  testProcessorLock,
  type ProcessorLockFactory,
} from './processorLock.features';

let postgres: StartedPostgreSqlContainer;
let pool: PgPool;

beforeAll(async () => {
  postgres = await getPostgreSQLStartedContainer();
  const connectionString = postgres.getConnectionUri();

  pool = dumbo({
    connectionString,
    driver: pgDumboDriver,
    transactionOptions: { allowNestedTransactions: true },
  });
  await createEventStoreSchema(connectionString, pool);
}, 120000);

afterAll(async () => {
  await pool?.close();
  await postgres?.stop();
});

const postgreSQLProcessorLockFactory: ProcessorLockFactory<
  PostgreSQLProcessorLockContext
> = () =>
  Promise.resolve({
    createLock: ({ processorId, processorInstanceId }) =>
      postgreSQLProcessorLock({
        processorId,
        processorInstanceId,
        partition: defaultTag,
        version: 1,
      }),
    // each operation gets its own transaction, as the processor's processing
    // scope does
    withContext: (handler) =>
      pool.withTransaction((transaction) =>
        handler({ execute: transaction.execute }),
      ),
  });

void describe('PostgreSQL processor lock', () => {
  testProcessorLock(postgreSQLProcessorLockFactory);
});
