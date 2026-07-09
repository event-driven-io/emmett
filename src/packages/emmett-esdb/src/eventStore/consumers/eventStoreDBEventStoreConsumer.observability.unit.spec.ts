import {
  collectingMeter,
  collectingTracer,
  LogEvent,
} from '@event-driven-io/almanac';
import type {
  AnyRecordedMessageMetadata,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import { describe, expect, it } from 'vitest';
import { eventStoreDBEventStoreConsumer } from './eventStoreDBEventStoreConsumer';

const makeMessage = (
  type: string,
  metadata: Partial<ReadEventMetadataWithGlobalPosition> = {},
) => ({
  type,
  kind: 'Event' as const,
  data: {},
  metadata: {
    globalPosition: 1n,
    ...metadata,
  } as AnyRecordedMessageMetadata,
});

describe('EventStoreDB consumer observability', () => {
  it('passes consumer observability to processors registered from it', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const consumer = eventStoreDBEventStoreConsumer({
      client: {} as EventStoreDBClient,
      observability: { tracer, meter },
    });
    const processor = consumer.reactor({
      processorId: 'test',
      eachMessage: () => Promise.resolve(),
    });

    await processor.start({});
    await processor.handle([makeMessage('OrderPlaced')], {});
    await processor.close({});

    expect(tracer.spans.some((span) => span.name === 'processor.handle')).toBe(
      true,
    );
  });

  it('lets processor observability override consumer observability', async () => {
    const consumerTracer = collectingTracer();
    const processorTracer = collectingTracer();
    const meter = collectingMeter();
    const consumer = eventStoreDBEventStoreConsumer({
      client: {} as EventStoreDBClient,
      observability: { tracer: consumerTracer, meter },
    });
    const processor = consumer.reactor({
      processorId: 'test',
      eachMessage: () => Promise.resolve(),
      observability: { tracer: processorTracer, meter },
    });

    await processor.start({});
    await processor.handle([makeMessage('OrderPlaced')], {});
    await processor.close({});

    expect(
      processorTracer.spans.some((span) => span.name === 'processor.handle'),
    ).toBe(true);
    expect(
      consumerTracer.spans.some((span) => span.name === 'processor.handle'),
    ).toBe(false);
  });

  it('keeps logging disabled by default', async () => {
    const consumer = eventStoreDBEventStoreConsumer({
      client: {} as EventStoreDBClient,
    });
    const processor = consumer.reactor({
      processorId: 'test',
      eachMessage: (_, context) => {
        context.observabilityScope.log(LogEvent.info('not exported'));
      },
    });

    await processor.start({});
    await processor.handle([makeMessage('OrderPlaced')], {});
    await processor.close({});
  });
});
