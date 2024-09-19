import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe } from 'node:test';
import { testAggregateStream, type EventStoreFactory } from '..//features';

void describe('EventStoreDBEventStore', async () => {
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
