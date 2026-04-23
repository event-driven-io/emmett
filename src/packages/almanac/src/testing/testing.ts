import type { AttributeTarget } from '../attributes';
import type { TracePropagation } from '../tracers';
import { collectingMeter, type CollectingMeter } from './collectingMeter';
import { collectingTracer, type CollectingTracer } from './collectingTracer';
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

export type TracingSpecification = (given: {
  propagation?: TracePropagation;
  attributeTarget?: AttributeTarget;
}) => {
  when: (fn: (config: ObservabilityTestConfig) => unknown) => {
    then: (
      assertFn: (result: { spans: SpanCollectionAssertions }) => void,
    ) => Promise<void>;
  };
};

export const ObservabilitySpec = {
  for: (): TracingSpecification => {
    return (given) => ({
      when: (fn) => {
        const execute = (() => {
          let cached:
            | { tracer: CollectingTracer; meter: CollectingMeter }
            | undefined;
          return async () => {
            if (!cached) {
              const tracer = collectingTracer();
              const meter = collectingMeter();
              await fn({
                tracer,
                meter,
                propagation: given.propagation ?? 'links',
                attributeTarget: given.attributeTarget ?? 'both',
                includeMessagePayloads: false,
              });
              cached = { tracer, meter };
            }
            return cached;
          };
        })();

        return {
          then: async (assertFn) => {
            const { tracer } = await execute();
            assertFn({ spans: assertThatSpans(tracer.spans) });
          },
        };
      },
    });
  },
};
