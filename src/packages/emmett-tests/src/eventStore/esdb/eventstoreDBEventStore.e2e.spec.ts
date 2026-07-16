//import { streamTransformations, type Event } from '@event-driven-io/emmett';
import {
  MessagingAttributes,
  ObservabilitySpec,
} from '@event-driven-io/almanac';
import {
  EmmettAttributes,
  MessagingSystemName,
  type Event,
} from '@event-driven-io/emmett';
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
  const M = MessagingAttributes;
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

  it('records observability spans while appending with ESDB storage', async () => {
    const given = ObservabilitySpec.for();
    const container = await getSharedEventStoreDBTestContainer();
    const streamName = `observed-${uuid()}`;

    try {
      await given((observability) => ({
        eventStore: getEventStoreDBEventStore(container.getClient(), {
          observability,
        }),
      }))
        .when(async ({ eventStore }) => {
          await eventStore.appendToStream(streamName, [
            { type: 'Observed', data: { observed: true } },
          ]);
        })
        .then(({ spans }) => {
          spans.hasSingleSpanNamed('eventStore.appendToStream').hasAttributes({
            [EmmettAttributes.eventStore.operation]: 'appendToStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.append.batchSize]: 1,
            [EmmettAttributes.eventStore.append.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 0,
            [M.operation.type]: 'send',
            [M.batch.messageCount]: 1,
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
        });
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
  });

  it('records observability spans while reading with ESDB storage', async () => {
    const given = ObservabilitySpec.for();
    const container = await getSharedEventStoreDBTestContainer();
    const streamName = `observed-${uuid()}`;

    try {
      await given(async (observability) => {
        const eventStore = getEventStoreDBEventStore(container.getClient(), {
          observability,
        });
        await eventStore.appendToStream(streamName, [
          { type: 'Observed', data: { observed: true } },
        ]);
        return {
          eventStore,
        };
      })
        .when(async ({ eventStore }) => {
          await eventStore.readStream(streamName);
        })
        .then(({ spans }) => {
          spans.hasSingleSpanNamed('eventStore.readStream').hasAttributes({
            [EmmettAttributes.eventStore.operation]: 'readStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.read.status]: 'success',
            [EmmettAttributes.eventStore.read.eventCount]: 1,
            [EmmettAttributes.eventStore.read.eventTypes]: ['Observed'],
            [M.operation.type]: 'receive',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
        });
    } finally {
      await releaseSharedEventStoreDBTestContainer();
    }
  });

  it('records observability spans while aggregating with ESDB storage', async () => {
    const given = ObservabilitySpec.for();
    const container = await getSharedEventStoreDBTestContainer();
    const streamName = `observed-${uuid()}`;

    try {
      await given(async (observability) => {
        const eventStore = getEventStoreDBEventStore(container.getClient(), {
          observability,
        });
        await eventStore.appendToStream(streamName, [
          { type: 'Observed', data: { observed: true } },
        ]);
        return {
          eventStore,
        };
      })
        .when(async ({ eventStore }) => {
          await eventStore.aggregateStream<{ observed: number }, Event>(
            streamName,
            {
              initialState: () => ({ observed: 0 }),
              evolve: (state: { observed: number }) => ({
                observed: state.observed + 1,
              }),
            },
          );
        })
        .then(({ spans }) => {
          spans.hasSingleSpanNamed('eventStore.aggregateStream').hasAttributes({
            [EmmettAttributes.eventStore.operation]: 'aggregateStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.aggregate.status]: 'success',
            [EmmettAttributes.stream.versionAfter]: 0,
            [M.operation.type]: 'process',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });

          spans.hasSingleSpanNamed('eventStore.readStream').hasAttributes({
            [EmmettAttributes.eventStore.operation]: 'readStream',
            [EmmettAttributes.stream.name]: streamName,
            [EmmettAttributes.eventStore.read.status]: 'success',
            [EmmettAttributes.eventStore.read.eventCount]: 1,
            [EmmettAttributes.eventStore.read.eventTypes]: ['Observed'],
            [M.operation.type]: 'receive',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });
        });
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
