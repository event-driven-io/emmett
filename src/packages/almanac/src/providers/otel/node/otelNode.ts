import {
  NodeSDK,
  tracing,
  type NodeSDKConfiguration,
} from '@opentelemetry/sdk-node';
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

const noopSpanProcessor = new tracing.NoopSpanProcessor();

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
    spanProcessor,
    spanProcessors,
    metricReader,
    metricReaders,
    logRecordProcessor,
    logRecordProcessors,
    ...configuration
  } = nodeSDKOptions;

  const sdk = new NodeSDK({
    ...configuration,
    ...(usesTracing
      ? { traceExporter, spanProcessor, spanProcessors }
      : { spanProcessors: [noopSpanProcessor] }),
    ...(usesMetrics ? { metricReader, metricReaders } : { metricReaders: [] }),
    ...(usesLogging
      ? { logRecordProcessor, logRecordProcessors }
      : { logRecordProcessors: [] }),
  });

  return otelAdapters({ sdk, tracing, metrics, logging });
};
