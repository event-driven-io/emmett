import type {
  AttributeTarget,
  Meter,
  ObservabilityConfig,
  Sampler,
  TracePropagation,
  Tracer,
} from '@event-driven-io/almanac';
import {
  compositeMeter,
  compositeTracer,
  noopMeter,
  noopTracer,
} from '@event-driven-io/almanac';
import { otelMeter, otelTracer } from '@event-driven-io/almanac/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import type { Instrumentation } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { readFileSync } from 'node:fs';

export type ObservabilityProvider<T = unknown> = {
  tracer: Tracer;
  meter: Meter;
  shutdown: () => Promise<void>;
} & T;

export type SetupOtelOptions = {
  serviceName?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  instrumentations?: Instrumentation[];
  resourceAttributes?: Record<string, string>;
};

export const setupOtel = (
  options?: SetupOtelOptions,
): ObservabilityProvider<{ sdk: NodeSDK }> => {
  const serviceName =
    options?.serviceName ??
    process.env.OTEL_SERVICE_NAME ??
    readPkgName() ??
    'unknown-service';

  const otlpEndpoint =
    options?.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    'http://localhost:4318';

  const traceExporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  const sdk = new NodeSDK({
    serviceName,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
    instrumentations: options?.instrumentations ?? defaultInstrumentations(),
  });

  sdk.start();

  return {
    tracer: otelTracer(),
    meter: otelMeter(),
    shutdown: () => sdk.shutdown(),
    sdk,
  };
};

const defaultInstrumentations = (): Instrumentation[] => [
  new HttpInstrumentation({
    ignoreIncomingRequestHook: (req) => req.url === '/health',
  }),
  new ExpressInstrumentation(),
  new PgInstrumentation(),
];

const readPkgName = (): string | undefined => {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
};

export type SetupObservabilityOptions<
  P extends Record<string, ObservabilityProvider<unknown>>,
> = {
  providers: P;
  sampler?: Sampler;
  propagation?: TracePropagation;
  attributeTarget?: AttributeTarget;
  attributePrefix?: string;
};

export type SetupObservabilityResult<
  P extends Record<string, ObservabilityProvider<unknown>>,
> = {
  observability: ObservabilityConfig<string>;
  shutdown: () => Promise<void>;
  providers: P;
};

export const setupObservability = <
  P extends Record<string, ObservabilityProvider<unknown>>,
>(
  options: SetupObservabilityOptions<P>,
): SetupObservabilityResult<P> => {
  const { providers, sampler, propagation, attributeTarget, attributePrefix } =
    options;

  const providerList = Object.values(providers);
  const tracers = providerList.map((p) => p.tracer);
  const meters = providerList.map((p) => p.meter);

  const tracer =
    tracers.length === 0
      ? noopTracer()
      : tracers.length === 1
        ? tracers[0]
        : compositeTracer(...tracers);

  const meter =
    meters.length === 0
      ? noopMeter()
      : meters.length === 1
        ? meters[0]
        : compositeMeter(...meters);

  const observability: ObservabilityConfig<string> = {
    tracer,
    meter,
    ...(sampler !== undefined ? { sampler } : {}),
    ...(propagation !== undefined ? { propagation } : {}),
    ...(attributeTarget !== undefined ? { attributeTarget } : {}),
    ...(attributePrefix !== undefined ? { attributePrefix } : {}),
  };

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    const reversed = [...providerList].reverse();
    await Promise.allSettled(reversed.map((p) => p.shutdown()));
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  console.log(
    `Telemetry started (providers: ${Object.keys(providers).join(', ')})`,
  );

  return { observability, shutdown, providers };
};
