import type { ObservabilityOptions } from '../../configuration/observability';
import { lifecycle } from '../../lifecycle';
import { otelLogger } from './otelLogger';
import { otelMeter } from './otelMeter';
import { otelTracer } from './otelTracer';

export type OtelSDK = {
  start(): void | Promise<void>;
  shutdown(): void | Promise<void>;
};

export type OtelOptions = ObservabilityOptions & {
  sdk?: OtelSDK;
};

export const otel = (options: OtelOptions = {}): ObservabilityOptions => {
  const { sdk, tracing, metrics, logging } = options;
  const usesOtel =
    tracing === undefined || metrics === undefined || logging === undefined;

  if (usesOtel && sdk !== undefined) {
    lifecycle({
      start: () => sdk.start(),
      shutdown: () => sdk.shutdown(),
    });
  }

  return {
    tracing: tracing ?? otelTracer(),
    metrics: metrics ?? otelMeter(),
    logging: logging ?? otelLogger(),
  };
};
