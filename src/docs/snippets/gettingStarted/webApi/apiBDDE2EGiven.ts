/* eslint-disable @typescript-eslint/no-unused-vars */
import { after, before, describe } from 'node:test';
import { shoppingCartApi } from './simpleApi';

const unitPrice = 100;
const now = new Date();

// #region test-container
import {
  getPostgreSQLEventStore,
  type PostgresEventStore,
} from '@event-driven-io/emmett-postgresql';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

void describe('ShoppingCart E2E', () => {
  let postgreSQLContainer: StartedPostgreSqlContainer;
  let eventStore: PostgresEventStore;

  // Set up a container and event store before all tests
  before(async () => {
    postgreSQLContainer = await new PostgreSqlContainer(
      'postgres:18.1',
    ).start();
    eventStore = getPostgreSQLEventStore(
      postgreSQLContainer.getConnectionUri(),
    );
  });

  // Close PostgreSQL connection and stop container once we finished testing
  after(async () => {
    await eventStore.close();
    return postgreSQLContainer.stop();
  });
  // (...) Tests will go here
});
// #endregion test-container

const eventStore: PostgresEventStore = undefined!;
// #region given
import {
  ApiE2ESpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';

const given = ApiE2ESpecification.for(
  () => eventStore,
  (eventStore) =>
    getApplication({
      apis: [
        shoppingCartApi(
          eventStore,
          () => Promise.resolve(unitPrice),
          () => now,
        ),
      ],
    }),
);
// #endregion given
