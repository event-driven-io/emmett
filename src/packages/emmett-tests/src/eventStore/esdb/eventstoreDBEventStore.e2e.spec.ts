//import { streamTransformations, type Event } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe } from 'node:test';
import { testAggregateStream, type EventStoreFactory } from '../features';

// const { stopOn } = streamTransformations;

// type MockEvent = Event<'Mocked', { mocked: true }>;

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
