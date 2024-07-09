import { describe, it } from 'node:test';
import { getInMemoryEventStore, isGlobalStreamCaughtUp } from '../eventStore';
import { collect, streamTransformations } from '../streaming';
import { assertEqual } from '../testing';
import { testAggregateStream } from '../testing/features';
import { type Event } from '../typing';

const { stopOn } = streamTransformations;

type MockEvent = Event<'Mocked', { mocked: true }>;

void describe('InMemoryEventStore', () => {
  void testAggregateStream(() => Promise.resolve(getInMemoryEventStore()));

  void it('Successful subscription and processing of events', async () => {
    const eventStore = getInMemoryEventStore();
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
