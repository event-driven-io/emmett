import {
  MessagingAttributes,
  noopLogger,
  noopMeter,
  noopTracer,
  ObservabilityScope as createObservabilityScope,
  type AttributeTarget,
  type Logger,
  type Meter,
  type ObservabilityScope,
  type Tracer,
} from '@event-driven-io/almanac';
import type {
  AggregateStreamResult,
  AppendToStreamResult,
  ReadStreamResult,
} from '..';
import {
  EmmettAttributes,
  EmmettMetrics,
  MessagingSystemName,
  type EmmettObservabilityConfig,
  type OperationObservabilityOptions,
  withOperationAttributes,
} from '../../observability';
import { mergeWithDefaultObservability } from '../../observability/defaultObservability';
import type { AnyReadEventMetadata, Event, ReadEvent } from '../../typing';

export type EventStoreObservabilityConfig = Pick<
  EmmettObservabilityConfig,
  'tracer' | 'meter' | 'logger' | 'attributeTarget'
>;

export type ResolvedEventStoreObservability = {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  attributeTarget: AttributeTarget;
  attributePrefix?: 'emmett';
};

export const eventStoreObservability = (
  options: { observability?: EventStoreObservabilityConfig } | undefined,
  parent?: EmmettObservabilityConfig,
): ResolvedEventStoreObservability => {
  const observability = mergeWithDefaultObservability(
    parent,
    options?.observability,
  );

  return {
    tracer: observability?.tracer ?? noopTracer(),
    meter: observability?.meter ?? noopMeter(),
    logger: observability?.logger ?? noopLogger,
    attributeTarget: observability?.attributeTarget ?? 'both',
    attributePrefix: 'emmett',
  };
};

export const eventStoreCollector = (
  observability: ResolvedEventStoreObservability,
) => {
  const { startScope } = createObservabilityScope({
    ...observability,
    attributePrefix: 'emmett',
  });
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
  const streamAggregatingDuration = observability.meter.histogram(
    EmmettMetrics.stream.aggregatingDuration,
  );
  const startOperationScope = <T>(
    name: string,
    fn: (scope: ObservabilityScope) => Promise<T>,
    options?: OperationObservabilityOptions,
  ): Promise<T> => {
    if (options?.scope) {
      const { scope, ...scopeOptions } = options;
      return scope.scope(name, fn, scopeOptions);
    }

    return startScope(name, fn, options);
  };
  const readAttributes = (streamName: string): Record<string, unknown> => ({
    [A.eventStore.operation]: 'readStream',
    [A.stream.name]: streamName,
    [M.operation.type]: 'receive',
    [M.destination.name]: streamName,
    [M.system]: MessagingSystemName,
  });

  const readStream = <
    EventType extends Event,
    ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
  >(
    fn: (
      scope: ObservabilityScope,
    ) => Promise<ReadStreamResult<EventType, ReadEventMetadataType>>,
  ) => {
    const start = Date.now();
    return async (
      scope: ObservabilityScope,
    ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>> => {
      let status = 'success';
      try {
        const result = await fn(scope);
        const events: ReadEvent<EventType, ReadEventMetadataType>[] =
          result.events;
        scope.setAttributes({
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
        scope.setAttributes({ [A.eventStore.read.status]: status });
        throw err;
      } finally {
        streamReadingDuration.record(Date.now() - start, {
          [A.eventStore.read.status]: status,
        });
      }
    };
  };

  return {
    instrumentRead: <
      EventType extends Event,
      ReadEventMetadataType extends AnyReadEventMetadata = AnyReadEventMetadata,
    >(
      streamName: string,
      fn: (
        scope: ObservabilityScope,
      ) => Promise<ReadStreamResult<EventType, ReadEventMetadataType>>,
      options?: OperationObservabilityOptions,
    ): Promise<ReadStreamResult<EventType, ReadEventMetadataType>> => {
      return startOperationScope(
        'eventStore.readStream',
        readStream(fn),
        withOperationAttributes(options, readAttributes(streamName)),
      );
    },

    instrumentAppend: <
      Result extends AppendToStreamResult,
      EventType extends Event = Event,
    >(
      streamName: string,
      events: EventType[],
      fn: (scope: ObservabilityScope) => Promise<Result>,
      options?: OperationObservabilityOptions,
    ): Promise<Result> => {
      const start = Date.now();
      return startOperationScope(
        'eventStore.appendToStream',
        async (scope) => {
          let status = 'success';
          try {
            const result = await fn(scope);
            scope.setAttributes({
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
            scope.setAttributes({ [A.eventStore.append.status]: status });
            throw err;
          } finally {
            streamAppendingDuration.record(Date.now() - start, {
              [A.eventStore.append.status]: status,
            });
          }
        },
        withOperationAttributes(options, {
          [A.eventStore.operation]: 'appendToStream',
          [A.stream.name]: streamName,
          [A.eventStore.append.batchSize]: events.length,
          [M.operation.type]: 'send',
          [M.batch.messageCount]: events.length,
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        }),
      );
    },

    instrumentAggregate: <Result extends AggregateStreamResult<unknown>>(
      streamName: string,
      fn: (scope: ObservabilityScope) => Promise<Result>,
      options?: OperationObservabilityOptions,
    ): Promise<Result> => {
      const start = Date.now();
      return startOperationScope(
        'eventStore.aggregateStream',
        async (scope) => {
          let status = 'success';
          try {
            const result = await fn(scope);
            scope.setAttributes({
              [A.eventStore.aggregate.status]: status,
              [A.stream.versionAfter]: Number(result.currentStreamVersion),
            });
            return result;
          } catch (err) {
            status = 'failure';
            scope.setAttributes({ [A.eventStore.aggregate.status]: status });
            throw err;
          } finally {
            streamAggregatingDuration.record(Date.now() - start, {
              [A.eventStore.aggregate.status]: status,
            });
          }
        },
        withOperationAttributes(options, {
          [A.eventStore.operation]: 'aggregateStream',
          [A.stream.name]: streamName,
          [M.operation.type]: 'process',
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        }),
      );
    },

    instrumentInlineProjection: <T>(
      streamName: string,
      appendScope: ObservabilityScope,
      fn: (scope: ObservabilityScope) => Promise<T>,
    ): Promise<T> => {
      return appendScope.scope('eventStore.inlineProjection', fn, {
        attributes: {
          [A.eventStore.operation]: 'inlineProjection',
          [A.stream.name]: streamName,
          [M.operation.type]: 'process',
          [M.destination.name]: streamName,
          [M.system]: MessagingSystemName,
        },
      });
    },
  };
};
