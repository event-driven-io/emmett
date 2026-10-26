import { NodeSDK, type NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import type { ObservabilityOptions } from '../../../configuration';
import { otel as otelAdapters, type OtelSDK } from '../otel';

type InjectedNodeSDK = ObservabilityOptions & {
  sdk: OtelSDK;
};

type AlmanacNodeSDK = ObservabilityOptions &
  Partial<NodeSDKConfiguration> & {
    sdk?: never;
  };

export type OtelNodeOptions = InjectedNodeSDK | AlmanacNodeSDK;

const hasInjectedSDK = (options: OtelNodeOptions): options is InjectedNodeSDK =>
  options.sdk !== undefined;

type SpanProcessor = NonNullable<
  NodeSDKConfiguration['spanProcessors']
>[number];

const noopSpanProcessor: SpanProcessor = {
  onStart: () => {},
  onEnd: () => {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

export const otel = (options: OtelNodeOptions = {}): ObservabilityOptions => {
  if (hasInjectedSDK(options)) {
    const { sdk, tracing, metrics, logging } = options;
    return otelAdapters({ sdk, tracing, metrics, logging });
  }

  const { tracing, metrics, logging, ...nodeSDKOptions } = options;

  const usesTracing = tracing === undefined;
  const usesMetrics = metrics === undefined;
  const usesLogging = logging === undefined;

  if (!usesTracing && !usesMetrics && !usesLogging)
    return otelAdapters({ tracing, metrics, logging });

  const {
    traceExporter,
    spanProcessors,
    metricReaders,
    logRecordProcessors,
    ...configuration
  } = nodeSDKOptions;

  const sdk = new NodeSDK({
    ...configuration,
    ...(usesTracing
      ? { traceExporter, spanProcessors }
      : { spanProcessors: [noopSpanProcessor] }),
    ...(usesMetrics ? { metricReaders } : { metricReaders: [] }),
    ...(usesLogging ? { logRecordProcessors } : { logRecordProcessors: [] }),
  });

  return otelAdapters({ sdk, tracing, metrics, logging });
};
