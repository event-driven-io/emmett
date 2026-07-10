import type {
  ObservabilityConfig,
  ObservabilityScope,
} from '@event-driven-io/almanac';

export type WithObservabilityScope<Context> = Context & {
  observabilityScope: ObservabilityScope;
};

export type PollTracing = 'off' | 'active' | 'verbose';

export type EmmettObservabilityConfig = ObservabilityConfig<'emmett'> & {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
};

export type EmmettObservabilityOptions = {
  observability?: EmmettObservabilityConfig;
};

export const mergeObservabilityOptions = <
  Config extends Partial<EmmettObservabilityConfig>,
  Options extends { observability?: Config },
>(
  options: Options,
  defaults: Partial<EmmettObservabilityConfig> | undefined,
): Options => {
  const observability =
    defaults === undefined
      ? options.observability
      : options.observability === undefined
        ? defaults
        : { ...defaults, ...options.observability };
  if (observability === options.observability) return options;

  return {
    ...options,
    observability,
  };
};
