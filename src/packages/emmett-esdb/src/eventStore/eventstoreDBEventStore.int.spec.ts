import { assertEqual, assertIsNotNull } from '@event-driven-io/emmett';
import type { StartedEventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { EventStoreDBContainer } from '@event-driven-io/emmett-testcontainers';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from './eventstoreDBEventStore';
import type { Event } from '@event-driven-io/emmett';

type TestEvent = Event<'ProductItemAdded', { productId: string }>;

void describe('EventStoreDBEventStore', () => {
  let eventStoreDB: StartedEventStoreDBContainer;
  let eventStore: EventStoreDBEventStore;

  beforeAll(async () => {
    eventStoreDB = await new EventStoreDBContainer().start();
    eventStore = getEventStoreDBEventStore(eventStoreDB.getClient());
  });

  afterAll(async () => {
    try {
      await eventStoreDB.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('should store correlationId and causationId in event metadata', async () => {
    const streamName = `test-${uuid()}`;
    const correlationId = uuid();
    const causationId = uuid();

    await eventStore.appendToStream<TestEvent>(
      streamName,
      [{ type: 'ProductItemAdded', data: { productId: '123' } }],
      { correlationId, causationId },
    );

    const { events } = await eventStore.readStream<TestEvent>(streamName);

    assertIsNotNull(events);
    assertEqual(1, events.length);
    assertEqual(correlationId, events[0]!.metadata.correlationId);
    assertEqual(causationId, events[0]!.metadata.causationId);
  });

  void it('should store correlationId without causationId when only correlationId is provided', async () => {
    const streamName = `test-${uuid()}`;
    const correlationId = uuid();

    await eventStore.appendToStream<TestEvent>(
      streamName,
      [{ type: 'ProductItemAdded', data: { productId: '123' } }],
      { correlationId },
    );

    const { events } = await eventStore.readStream<TestEvent>(streamName);

    assertIsNotNull(events);
    assertEqual(1, events.length);
    assertEqual(correlationId, events[0]!.metadata.correlationId);
    assertEqual(undefined, events[0]!.metadata.causationId);
  });

  void it('should propagate correlationId and causationId to all events in a batch', async () => {
    const streamName = `test-${uuid()}`;
    const correlationId = uuid();
    const causationId = uuid();

    await eventStore.appendToStream<TestEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productId: '1' } },
        { type: 'ProductItemAdded', data: { productId: '2' } },
        { type: 'ProductItemAdded', data: { productId: '3' } },
      ],
      { correlationId, causationId },
    );

    const { events } = await eventStore.readStream<TestEvent>(streamName);

    assertIsNotNull(events);
    assertEqual(3, events.length);
    for (const event of events) {
      assertEqual(correlationId, event.metadata.correlationId);
      assertEqual(causationId, event.metadata.causationId);
    }
  });
});
