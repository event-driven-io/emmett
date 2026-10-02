import {
  getPostgreSQLEventStore,
  postgreSQLEventStoreConsumer,
} from '@event-driven-io/emmett-postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import {
  testReactorRecordsFailureAsEvent,
  testReactorSkipsAndStops,
  type ConsumerFactory,
  type ReactorConsumer,
} from './reactorErrors.features';
import { pgEventStoreDriver } from '@event-driven-io/emmett-postgresql/pg';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../testing/postgreSQLTestDatabase';

let database: PostgreSQLTestDatabase;
let connectionString: string;

beforeAll(async () => {
  database = await sharedPostgreSQLDatabase();
  connectionString = database.connectionString;
});

afterAll(async () => {
  await database?.close();
});

const postgreSQLConsumerFactory: ConsumerFactory = () => {
  const eventStore = getPostgreSQLEventStore({
    driver: pgEventStoreDriver,
    connectionString: connectionString,
  });

  const consumer = postgreSQLEventStoreConsumer({
    connectionString,
  }) as unknown as ReactorConsumer;

  return Promise.resolve({
    eventStore,
    consumer,
    teardown: () => eventStore.close(),
  });
};

void describe('PostgreSQL consumer', () => {
  testReactorRecordsFailureAsEvent(postgreSQLConsumerFactory);
  testReactorSkipsAndStops(postgreSQLConsumerFactory);
});
