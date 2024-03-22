/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { after, before, describe } from 'node:test';
import { shoppingCartApi } from './simpleApi';

const unitPrice = 100;
const now = new Date();

// #region test-container
import {
  EventStoreDBContainer,
  type StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';

let esdbContainer: StartedEventStoreDBContainer;
describe('ShoppingCart E2E', () => {
  // Set up a container before all tests
  before(async () => {
    esdbContainer = await new EventStoreDBContainer().start();
  });

  // Stop container once we finished testing
  after(() => {
    return esdbContainer.stop();
  });
  // (...) Tests will go here
});
// #endregion test-container

// #region given
import { type EventStore } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import {
  ApiE2ESpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';

const given = ApiE2ESpecification.for(
  (): EventStore => getEventStoreDBEventStore(esdbContainer.getClient()),
  (eventStore: EventStore) =>
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
