import {
  MessagingAttributes,
  noopMeter,
  noopTracer,
  type AttributeTarget,
  type Meter,
  type Tracer,
} from '@event-driven-io/almanac';
import type { AppendToStreamResult, ReadStreamResult } from '..';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  type EmmettObservabilityConfig,
  type EmmettObservabilityOptions,
} from '../../observability';
import type { AnyReadEventMetadata, Event, ReadEvent } from '../../typing';

export type EventStoreObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'attributeTarget'
>;

export type ResolvedEventStoreObservability = {
  tracer: Tracer;
  meter: Meter;
  attributeTarget: AttributeTarget;
};

export const eventStoreObservability = (
  options: { observability?: EventStoreObservabilityConfig } | undefined,
  parent?: EmmettObservabilityOptions,
): ResolvedEventStoreObservability => ({
  tracer:
    options?.observability?.tracer ??
    parent?.observability?.tracer ??
    noopTracer(),
  meter:
    options?.observability?.meter ??
    parent?.observability?.meter ??
    noopMeter(),
  attributeTarget:
    options?.observability?.attributeTarget ??
    parent?.observability?.attributeTarget ??
    'both',
});

export const eventStoreCollector = (
  observability: ResolvedEventStoreObservability,
) => {
  const A = EmmettAttributes;
  const M = MessagingAttributes;
  const streamReadingDuration = observability.meter.histogram(
    EmmettMetrics.stream.readingDuration,
  );
  const streamReadingSize = observability.meter.histogram(
    EmmettMetrics.stream.readingSize,
  );
  const eventReadingCount = observability.meter.counter(
    EmmettMetrics.event.readingCount,
  );
  const streamAppendingDuration = observability.meter.histogram(
    EmmettMetrics.stream.appendingDuration,
  );
  const streamAppendingSize = observability.meter.histogram(
    EmmettMetrics.stream.appendingSize,
  );
  const eventAppendingCount = observability.meter.counter(
    EmmettMetrics.event.appendingCount,
  );

  return {
    instrumentRead: <
      EventType extends Event,
      ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
    >(
      streamName: string,
      fn: () => Promise<ReadStreamResult<EventType, ReadEventMetadataType>>,
    ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>> => {
      const start = Date.now();
      return observability.tracer.startSpan(
        'eventStore.readStream',
        async (span) => {
          span.setAttributes({
            [A.eventStore.operation]: 'readStream',
            [A.stream.name]: streamName,
            [M.operation.type]: 'receive',
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });

          let status = 'success';
          try {
            const result = await fn();
            const events: ReadEvent<EventType, ReadEventMetadataType>[] =
              result.events;
            span.setAttributes({
              [A.eventStore.read.status]: status,
              [A.eventStore.read.eventCount]: events.length,
              [A.eventStore.read.eventTypes]: [
                ...new Set(events.map((e) => e.type)),
              ],
            });
            streamReadingSize.record(events.length, {
              [A.eventStore.read.status]: status,
            });
            for (const event of events) {
              eventReadingCount.add(1, { [A.event.type]: event.type });
            }
            return result;
          } catch (err) {
            status = 'failure';
            span.setAttributes({ [A.eventStore.read.status]: status });
            throw err;
          } finally {
            streamReadingDuration.record(Date.now() - start, {
              [A.eventStore.read.status]: status,
            });
          }
        },
      );
    },

    instrumentAppend: <
      Result extends AppendToStreamResult,
      EventType extends Event = Event,
    >(
      streamName: string,
      events: EventType[],
      fn: () => Promise<Result>,
    ): Promise<Result> => {
      const start = Date.now();
      return observability.tracer.startSpan(
        'eventStore.appendToStream',
        async (span) => {
          span.setAttributes({
            [A.eventStore.operation]: 'appendToStream',
            [A.stream.name]: streamName,
            [A.eventStore.append.batchSize]: events.length,
            [M.operation.type]: 'send',
            [M.batch.messageCount]: events.length,
            [M.destination.name]: streamName,
            [M.system]: MessagingSystemName,
          });

          let status = 'success';
          try {
            const result = await fn();
            span.setAttributes({
              [A.eventStore.append.status]: status,
              [A.stream.versionAfter]: Number(result.nextExpectedStreamVersion),
            });
            streamAppendingSize.record(events.length, {
              [A.eventStore.append.status]: status,
            });
            for (const event of events) {
              eventAppendingCount.add(1, { [A.event.type]: event.type });
            }
            return result;
          } catch (err) {
            status = 'failure';
            span.setAttributes({ [A.eventStore.append.status]: status });
            throw err;
          } finally {
            streamAppendingDuration.record(Date.now() - start, {
              [A.eventStore.append.status]: status,
            });
          }
        },
      );
    },
  };
};
