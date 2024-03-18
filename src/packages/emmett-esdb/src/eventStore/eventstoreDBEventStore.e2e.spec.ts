/* eslint-disable @typescript-eslint/no-floating-promises */
import {
  testAggregateStream,
  type EventStoreFactory,
} from '@event-driven-io/emmett';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe } from 'node:test';
import { getEventStoreDBEventStore } from './eventstoreDBEventStore';

describe('EventStoreDBEventStore', async () => {
  let esdbContainer: StartedEventStoreDBContainer;

  const eventStoreFactory: EventStoreFactory = async () => {
    esdbContainer = await new EventStoreDBContainer().start();
    return getEventStoreDBEventStore(esdbContainer.getClient());
  };

  const teardownHook = async () => {
    await esdbContainer.stop();
  };

  await testAggregateStream(eventStoreFactory, {
    teardownHook,
    getInitialIndex: () => 0n,
  });
});
