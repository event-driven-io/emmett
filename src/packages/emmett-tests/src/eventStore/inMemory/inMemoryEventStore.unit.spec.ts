import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { describe } from 'vitest';
import { testAggregateStream, testStreamExists } from '../features';

// const { stopOn } = streamTransformations;

// type MockEvent = Event<'Mocked', { mocked: true }>;

describe('InMemoryEventStore', () => {
  testAggregateStream(() => Promise.resolve(getInMemoryEventStore()));

  testStreamExists(() => Promise.resolve(getInMemoryEventStore()));

  // void it('Successful subscription and processing of events', async () => {
  //   const eventStore = getInMemoryEventStore();
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
