import type { AttributeTarget } from '../attributes';
import type { Logger } from '../loggers';
import type { TraceContextGenerator, TracePropagation } from '../tracers';
import { collectingMeter, type CollectingMeter } from './collectingMeter';
import { collectingTracer, type CollectingTracer } from './collectingTracer';
import {
  assertThatMetrics,
  type MeterCollectionAssertions,
} from './meterAssertions';
import {
  assertThatSpans,
  type SpanCollectionAssertions,
} from './spanAssertions';

export type ObservabilityTestConfig = {
  tracer: CollectingTracer;
  meter: CollectingMeter;
  logger: Logger;
  propagation: TracePropagation;
  traceContextGenerator?: TraceContextGenerator;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

type MaybePromise<T> = T | PromiseLike<T>;

export type TracingSpecification = <T = undefined>(
  given: (config: ObservabilityTestConfig) => MaybePromise<T>,
  config?: Partial<ObservabilityTestConfig>,
) => {
  when: (fn: (sut: T, config: ObservabilityTestConfig) => unknown) => {
    then: (
      assertFn: (result: {
        sut: T;
        spans: SpanCollectionAssertions;
        metrics: MeterCollectionAssertions;
      }) => void,
    ) => Promise<void>;
    thenThrows: (
      assertFn: (result: {
        sut: T;
        spans: SpanCollectionAssertions;
        metrics: MeterCollectionAssertions;
        error: unknown;
      }) => void,
    ) => Promise<void>;
  };
};

export const ObservabilitySpec = {
  for: (config?: Partial<ObservabilityTestConfig>): TracingSpecification => {
    return <T>(
      given: (config: ObservabilityTestConfig) => MaybePromise<T>,
      testConfig?: Partial<ObservabilityTestConfig>,
    ) => ({
      when: (fn: (sut: T, config: ObservabilityTestConfig) => unknown) => {
        const execute = (() => {
          let cached:
            | {
                tracer: CollectingTracer;
                meter: CollectingMeter;
                sut: T;
                error?: unknown;
              }
            | undefined;
          return async () => {
            if (!cached) {
              const traceContextGenerator = {
                ...config,
                ...testConfig,
              }.traceContextGenerator;
              const tracer = collectingTracer(
                traceContextGenerator ? { traceContextGenerator } : undefined,
              );
              const meter = collectingMeter();
              const logger: Logger = (log) => {
                const span = tracer.spans.find(
                  (s) =>
                    s.ownContext.traceId === log.metadata.traceId &&
                    s.ownContext.spanId === log.metadata.spanId,
                );
                span?.logs.push(log);
              };

              const observability: ObservabilityTestConfig = {
                tracer,
                meter,
                logger,
                propagation: 'links',
                attributeTarget: 'both',
                includeMessagePayloads: false,
                ...config,
                ...testConfig,
              };

              const sut = await given(observability);

              let error: unknown;
              try {
                await fn(sut, observability);
              } catch (e) {
                error = e;
              }
              cached = { tracer, meter, sut, error };
            }
            return cached;
          };
        })();

        return {
          then: async (
            assertFn: (result: {
              sut: T;
              spans: SpanCollectionAssertions;
              metrics: MeterCollectionAssertions;
            }) => void,
          ) => {
            const { tracer, meter, sut, error } = await execute();
            if (error !== undefined) throw error as Error;
            assertFn({
              sut,
              spans: assertThatSpans(tracer.spans),
              metrics: assertThatMetrics(meter),
            });
          },
          thenThrows: async (
            assertFn: (result: {
              sut: T;
              spans: SpanCollectionAssertions;
              metrics: MeterCollectionAssertions;
              error: unknown;
            }) => void,
          ) => {
            const { tracer, meter, sut, error } = await execute();
            if (error === undefined)
              throw new Error('Expected operation to throw but it succeeded');
            assertFn({
              sut,
              spans: assertThatSpans(tracer.spans),
              metrics: assertThatMetrics(meter),
              error,
            });
          },
        };
      },
    });
  },
};
