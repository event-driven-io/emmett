import { RandomIdGenerator } from '@opentelemetry/sdk-trace-base';
import type { TraceContextGenerator } from '../../tracers';

const generator = new RandomIdGenerator();

export const otelTraceContextGenerator: TraceContextGenerator = {
  generateTraceId: () => generator.generateTraceId(),
  generateSpanId: () => generator.generateSpanId(),
};
