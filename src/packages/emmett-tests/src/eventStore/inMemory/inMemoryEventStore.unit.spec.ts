import { getInMemoryEventStore } from '@event-driven-io/emmett';
import { describe, expect } from 'vitest';
import {
  testAggregateStream,
  testAppendToStream,
  testCommandHandling,
  testConsumerSchemaVersion,
  testSchemaVersion,
  testStreamExists,
} from '../features';

// const { stopOn } = streamTransformations;

// type MockEvent = Event<'Mocked', { mocked: true }>;

describe('InMemoryEventStore', () => {
  testAggregateStream(() => Promise.resolve(getInMemoryEventStore()));

  testAppendToStream(() => Promise.resolve(getInMemoryEventStore()));

  testCommandHandling(() => Promise.resolve(getInMemoryEventStore()));

  testStreamExists(() => Promise.resolve(getInMemoryEventStore()));

  const storeMetadata = {
    globalPosition: expect.any(String) as unknown,
    checkpoint: expect.any(String) as unknown,
    correlationId: expect.any(String) as unknown,
    causationId: expect.any(String) as unknown,
    traceId: expect.any(String) as unknown,
    spanId: expect.any(String) as unknown,
  };

  testSchemaVersion(() => Promise.resolve(getInMemoryEventStore()), {
    getInitialIndex: () => 1n,
    storeMetadata,
  });

  testConsumerSchemaVersion(() => Promise.resolve(getInMemoryEventStore()), {
    getInitialIndex: () => 1n,
    storeMetadata,
  });

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
