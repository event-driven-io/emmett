import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { defaultTag } from '@event-driven-io/emmett';
import {
  createEventStoreSchema,
  postgreSQLProcessorLock,
  type PostgreSQLProcessorLockContext,
} from '@event-driven-io/emmett-postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';
import {
  testProcessorLock,
  type ProcessorLockFactory,
} from './processorLock.features';

let database: PostgreSQLTestDatabase;
let pool: PgPool;

beforeAll(async () => {
  database = await sharedPostgreSQLDatabase();

  pool = dumbo({
    connectionString: database.connectionString,
    driver: pgDumboDriver,
    transactionOptions: { allowNestedTransactions: true },
  });
  await createEventStoreSchema({ pool });
});

afterAll(async () => {
  await pool?.close();
  await database?.close();
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
