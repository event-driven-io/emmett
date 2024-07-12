import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { describe } from 'node:test';
import {
  testAggregateStream,
  type EventStoreFactory,
} from '../../../emmett/src/testing/features';
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from './postgreSQLEventStore';

void describe('EventStoreDBEventStore', async () => {
  let postgres: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;

  const eventStoreFactory: EventStoreFactory = async () => {
    postgres = await new PostgreSqlContainer().start();
    eventStore = getPostgreSQLEventStore(postgres.getConnectionUri());
    return eventStore;
  };

  const teardownHook = async () => {
    try {
      await eventStore.close();
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
