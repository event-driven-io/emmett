import { describe, it } from 'node:test';
import { getInMemoryEventStore, isGlobalStreamCaughtUp } from '../eventStore';
import { collect, streamTransformations } from '../streaming';
import { assertEqual } from '../testing';
import { type Event } from '../typing';
import { testAggregateStream } from '../testing/features';

const { stopOn } = streamTransformations;

type MockEvent = Event<'Mocked', { mocked: true }>;

void describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();

  void testAggregateStream(() => Promise.resolve(eventStore));

  void it('Successful subscription and processing of events', async () => {
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
