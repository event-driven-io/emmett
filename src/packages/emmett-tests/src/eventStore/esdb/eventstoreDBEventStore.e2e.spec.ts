//import { streamTransformations, type Event } from '@event-driven-io/emmett';
import { assertEqual, collectingTracer } from '@event-driven-io/emmett';
import { getEventStoreDBEventStore } from '@event-driven-io/emmett-esdb';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import {
  getSharedEventStoreDBTestContainer,
  releaseSharedEventStoreDBTestContainer,
} from '@event-driven-io/emmett-testcontainers';
import { describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  testAggregateStream,
  testStreamExists,
  type EventStoreFactory,
} from '../features';

// const { stopOn } = streamTransformations;

// type MockEvent = Event<'Mocked', { mocked: true }>;

describe('EventStoreDBEventStore', () => {
  let esdbContainer: StartedEventStoreDBContainer;

  const eventStoreFactory: EventStoreFactory = async () => {
    esdbContainer = await getSharedEventStoreDBTestContainer();
    return getEventStoreDBEventStore(esdbContainer.getClient());
  };

  const teardownHook = async () => {
    await releaseSharedEventStoreDBTestContainer();
  };

  testAggregateStream(eventStoreFactory, {
    teardownHook,
    getInitialIndex: () => 0n,
  });

  testStreamExists(eventStoreFactory, { teardownHook });

  it('records observability spans while appending and reading with ESDB storage', async () => {
    const tracer = collectingTracer();
    const container = await getSharedEventStoreDBTestContainer();
    const eventStore = getEventStoreDBEventStore(container.getClient(), {
      observability: { tracer },
    });
    const streamName = `observed-${uuid()}`;

    try {
      await eventStore.appendToStream(streamName, [
        { type: 'Observed', data: { observed: true } },
      ]);
      await eventStore.readStream(streamName);

      assertEqual(
        true,
        tracer.spans.some((span) => span.name === 'eventStore.appendToStream'),
      );
      assertEqual(
        true,
        tracer.spans.some((span) => span.name === 'eventStore.readStream'),
      );
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
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
