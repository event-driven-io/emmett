import { type Attributes, SpanKind, trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  type Sampler,
  SamplingDecision,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';

export const setupTracing = (serviceName: string) => {
  const exporter = new OTLPTraceExporter({});
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    sampler: filterSampler(ignoreHealthCheck, new AlwaysOnSampler()),
  });
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Express instrumentation expects HTTP layer to be instrumented
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
    ],
  });

  // Initialize the OpenTelemetry APIs to use the NodeTracerProvider bindings
  provider.register();

  return trace.getTracer(serviceName);
};

type FilterFunction = (
  spanName: string,
  spanKind: SpanKind,
  attributes: Attributes,
) => boolean;

function filterSampler(filterFn: FilterFunction, parent: Sampler): Sampler {
  return {
    shouldSample(ctx, tid, spanName, spanKind, attr, links) {
      if (!filterFn(spanName, spanKind, attr)) {
        return { decision: SamplingDecision.NOT_RECORD };
      }
      return parent.shouldSample(ctx, tid, spanName, spanKind, attr, links);
    },
    toString() {
      return `FilterSampler(${parent.toString()})`;
    },
  };
}

function ignoreHealthCheck(
  spanName: string,
  spanKind: SpanKind,
  attributes: Attributes,
) {
  return (
    spanKind !== SpanKind.SERVER || attributes[ATTR_HTTP_ROUTE] !== '/health'
  );
}
