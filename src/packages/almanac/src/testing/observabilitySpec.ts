import type { AttributeTarget } from '../attributes';
import type { TracePropagation } from '../tracers';
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
  propagation: TracePropagation;
  attributeTarget: AttributeTarget;
  includeMessagePayloads: boolean;
};

export type TracingSpecification = <T = undefined>(
  given: (config: ObservabilityTestConfig) => T,
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
  };
};

export const ObservabilitySpec = {
  for: (config?: Partial<ObservabilityTestConfig>): TracingSpecification => {
    return <T>(
      given: (config: ObservabilityTestConfig) => T,
      testConfig?: Partial<ObservabilityTestConfig>,
    ) => ({
      when: (fn: (sut: T, config: ObservabilityTestConfig) => unknown) => {
        const execute = (() => {
          let cached:
            | { tracer: CollectingTracer; meter: CollectingMeter; sut: T }
            | undefined;
          return async () => {
            if (!cached) {
              const tracer = collectingTracer();
              const meter = collectingMeter();

              const observability: ObservabilityTestConfig = {
                tracer,
                meter,
                propagation: 'links',
                attributeTarget: 'both',
                includeMessagePayloads: false,
                ...config,
                ...testConfig,
              };

              const sut = given(observability);

              await fn(sut, observability);
              cached = { tracer, meter, sut };
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
            const { tracer, meter, sut } = await execute();
            assertFn({
              sut,
              spans: assertThatSpans(tracer.spans),
              metrics: assertThatMetrics(meter),
            });
          },
        };
      },
    });
  },
};
