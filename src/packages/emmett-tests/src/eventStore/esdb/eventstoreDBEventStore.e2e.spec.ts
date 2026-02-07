//import { streamTransformations, type Event } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import {
  getSharedEventStoreDBTestContainer,
  releaseSharedEventStoreDBTestContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe } from 'node:test';
import {
  testAggregateStream,
  testStreamExists,
  type EventStoreFactory,
} from '../features';

// const { stopOn } = streamTransformations;

// type MockEvent = Event<'Mocked', { mocked: true }>;

void describe('EventStoreDBEventStore', async () => {
  let esdbContainer: StartedEventStoreDBContainer;

  const eventStoreFactory: EventStoreFactory = async () => {
    esdbContainer = await getSharedEventStoreDBTestContainer();
    return getEventStoreDBEventStore(esdbContainer.getClient());
  };

  const teardownHook = async () => {
    await releaseSharedEventStoreDBTestContainer();
  };

  await testAggregateStream(eventStoreFactory, {
    teardownHook,
    getInitialIndex: () => 0n,
  });

  await testStreamExists(eventStoreFactory, { teardownHook });

  // void it.skip('Successful subscription and processing of events', async () => {
  //   const eventStore = await eventStoreFactory();
  //   const streamName = 'test-stream';

  //   const events: MockEvent[] = [
  //     { type: 'Mocked', data: { mocked: true } },
  //     { type: 'Mocked', data: { mocked: true } },
  //   ];

  //   await eventStore.appendToStream(streamName, events);

  //   const readableStream = eventStore
  //     .streamEvents()
  //     .pipeThrough(stopOn(isGlobalStreamCaughtUp));

  //   const receivedEvents = await collect(readableStream);

  //   assertEqual(receivedEvents.length, events.length);
  // });
});
