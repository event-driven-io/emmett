import { describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import { assertEqual, assertIsNotNull } from '../testing';
import type { Event } from '../typing';
import { getInMemoryEventStore } from './inMemoryEventStore';

type TestEvent = Event<'ProductItemAdded', { productId: string }>;

void describe('InMemoryEventStore metadata', () => {
  void it('stores correlationId and causationId in event metadata', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `test:${uuid()}`;
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

  void it('stores correlationId without causationId when only correlationId is provided', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `test:${uuid()}`;
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

  void it('stores traceId and spanId in event metadata when provided', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `test:${uuid()}`;
    const traceId = 'trace-abc123';
    const spanId = 'span-def456';

    await eventStore.appendToStream<TestEvent>(
      streamName,
      [{ type: 'ProductItemAdded', data: { productId: '123' } }],
      { traceId, spanId },
    );

    const { events } = await eventStore.readStream<TestEvent>(streamName);

    assertIsNotNull(events);
    assertEqual(1, events.length);
    assertEqual(traceId, events[0]!.metadata.traceId);
    assertEqual(spanId, events[0]!.metadata.spanId);
  });

  void it('propagates traceId and spanId to all events in a batch', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `test:${uuid()}`;
    const traceId = 'trace-abc123';
    const spanId = 'span-def456';

    await eventStore.appendToStream<TestEvent>(
      streamName,
      [
        { type: 'ProductItemAdded', data: { productId: '1' } },
        { type: 'ProductItemAdded', data: { productId: '2' } },
      ],
      { traceId, spanId },
    );

    const { events } = await eventStore.readStream<TestEvent>(streamName);

    assertIsNotNull(events);
    assertEqual(2, events.length);
    for (const event of events) {
      assertEqual(traceId, event.metadata.traceId);
      assertEqual(spanId, event.metadata.spanId);
    }
  });

  void it('propagates correlationId and causationId to all events in a batch', async () => {
    const eventStore = getInMemoryEventStore();
    const streamName = `test:${uuid()}`;
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
