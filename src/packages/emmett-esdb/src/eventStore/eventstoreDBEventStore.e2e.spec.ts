import {
  assertEqual,
  collect,
  isGlobalStreamCaughtUp,
  streamTransformations,
  type Event,
} from '@event-driven-io/emmett';
import {
  EventStoreDBContainer,
  StartedEventStoreDBContainer,
} from '@event-driven-io/emmett-testcontainers';
import { after, describe, it } from 'node:test';
import {
  testAggregateStream,
  type EventStoreFactory,
} from '../../../emmett/src/testing/features';
import { getEventStoreDBEventStore } from './eventstoreDBEventStore';

const { stopOn } = streamTransformations;

type MockEvent = Event<'Mocked', { mocked: true }>;

void describe('EventStoreDBEventStore', async () => {
  let esdbContainer: StartedEventStoreDBContainer;

  const eventStoreFactory: EventStoreFactory = async () => {
    esdbContainer = await new EventStoreDBContainer().start();
    return getEventStoreDBEventStore(esdbContainer.getClient());
  };

  after(async () => {
    await esdbContainer.stop();
  });

  // const teardownHook = async () => {
  //   await esdbContainer.stop();
  // };

  await testAggregateStream(eventStoreFactory, {
    getInitialIndex: () => 0n,
  });

  void it.skip('Successful subscription and processing of events', async () => {
    const eventStore = await eventStoreFactory();
    const streamName = 'test-stream';

    const events: MockEvent[] = [
      { type: 'Mocked', data: { mocked: true } },
      { type: 'Mocked', data: { mocked: true } },
    ];

    await eventStore.appendToStream(streamName, events);

    const readableStream = eventStore
      .streamEvents()
      .pipeThrough(stopOn(isGlobalStreamCaughtUp));

    const receivedEvents = await collect(readableStream);

    assertEqual(receivedEvents.length, events.length);
  });
});
