import {
  getPostgreSQLEventStore,
  postgreSQLEventStoreConsumer,
} from '@event-driven-io/emmett-postgresql';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe } from 'vitest';
import {
  testReactorRecordsFailureAsEvent,
  testReactorSkipsAndStops,
  type ConsumerFactory,
  type ReactorConsumer,
} from './reactorErrors.features';

let postgres: StartedPostgreSqlContainer;
let connectionString: string;

beforeAll(async () => {
  postgres = await getPostgreSQLStartedContainer();
  connectionString = postgres.getConnectionUri();
}, 120000);

afterAll(async () => {
  await postgres?.stop();
});

const postgreSQLConsumerFactory: ConsumerFactory = () => {
  const eventStore = getPostgreSQLEventStore(connectionString);

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
