import assert from 'node:assert';
import { describe, it } from 'node:test';
import { getInMemoryEventStore, isGlobalStreamCaughtUp } from '../eventStore';
import { collect, streamTransformations } from '../streaming';
import { type Event } from '../typing';

const { stopOn } = streamTransformations;

type MockEvent = Event<'Mocked', { mocked: true }>;

void describe('InMemoryEventStore', () => {
  const eventStore = getInMemoryEventStore();

  void it('Successful subscription and processing of events', async () => {
    const streamName = 'test-stream';

    const events: MockEvent[] = [
      { type: 'Mocked', data: { mocked: true } },
      { type: 'Mocked', data: { mocked: true } },
    ];

    await eventStore.appendToStream(streamName, events);

    // Subscribe to the stream and process events
    const readableStream = eventStore
      .streamEvents()
      .pipeThrough(stopOn(isGlobalStreamCaughtUp));

    const receivedEvents = await collect(readableStream);

    assert.strictEqual(receivedEvents.length, events.length);
  });
});
