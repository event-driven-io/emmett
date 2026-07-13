import { noopLogger, type Logger } from '../loggers';
import { noopMeter, type Meter } from '../meters';
import { noopTracer, type Tracer } from '../tracers';
import { DISABLED, type Observability } from './options';

export type ObservabilityOptions = {
  tracing?: Tracer | typeof DISABLED;
  metrics?: Meter | typeof DISABLED;
  logging?: Logger | typeof DISABLED;
};

export const observability = (options: ObservabilityOptions = {}) => {
  const { tracing, metrics, logging } = options;
  return {
    tracer:
      tracing === undefined || tracing === DISABLED ? noopTracer() : tracing,
    meter:
      metrics === undefined || metrics === DISABLED ? noopMeter() : metrics,
    logger:
      logging === undefined || logging === DISABLED ? noopLogger : logging,
  };
};

export const mergeObservability = <
  Options extends Partial<Observability<string>>,
>(
  defaults: Options | undefined,
  overrides: Options | undefined,
): Options | undefined => {
  if (defaults === undefined) return overrides;
  if (overrides === undefined) return defaults;

  return { ...defaults, ...overrides };
};
