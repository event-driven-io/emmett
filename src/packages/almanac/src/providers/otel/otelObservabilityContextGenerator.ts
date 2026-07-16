import { RandomIdGenerator } from '@opentelemetry/sdk-trace-base';
import type { ObservabilityContextGenerator } from '../../tracers';

const generator = new RandomIdGenerator();

export const otelObservabilityContextGenerator: ObservabilityContextGenerator =
  {
    generateTraceId: () => generator.generateTraceId(),
    generateSpanId: () => generator.generateSpanId(),
    generateMessageId: () => generator.generateTraceId(),
    generateCorrelationId: () => generator.generateTraceId(),
    generateCausationId: () => generator.generateTraceId(),
  };

/** @deprecated Use otelObservabilityContextGenerator. */
export const otelTraceContextGenerator = otelObservabilityContextGenerator;
