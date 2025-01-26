/* eslint-disable @typescript-eslint/no-unused-vars */
import { after, before, describe } from 'node:test';
import { shoppingCartApi } from './simpleApi';

const unitPrice = 100;
const now = new Date();

// #region test-container
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

let postgreSQLContainer: StartedPostgreSqlContainer;
void describe('ShoppingCart E2E', () => {
  // Set up a container before all tests
  before(async () => {
    postgreSQLContainer = await new PostgreSqlContainer().start();
  });

  // Stop container once we finished testing
  after(() => {
    return postgreSQLContainer.stop();
  });
  // (...) Tests will go here
});
// #endregion test-container

// #region given
import {
  ApiE2ESpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';
import { getPostgreSQLEventStore } from '@event-driven-io/emmett-postgresql';

const given = ApiE2ESpecification.for(
  () => getPostgreSQLEventStore(postgreSQLContainer.getConnectionUri()),
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
