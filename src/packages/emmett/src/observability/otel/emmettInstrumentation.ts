import {
  AlmanacInstrumentation,
  type AlmanacInstrumentationConfig,
  type AlmanacObservabilityConfig,
} from '@event-driven-io/almanac/otel';
import type { EmmettObservabilityConfig, PollTracing } from '../options';

const EMMETT_INSTRUMENTATION_VERSION = '0.43.0-beta.27';

export interface EmmettInstrumentationConfig extends AlmanacInstrumentationConfig {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
}

export class EmmettInstrumentation extends AlmanacInstrumentation {
  constructor(config: EmmettInstrumentationConfig = {}) {
    super('@event-driven-io/emmett', EMMETT_INSTRUMENTATION_VERSION, {
      attributePrefix: 'emmett',
      ...config,
    });
  }

  protected override buildObservability(): AlmanacObservabilityConfig {
    const observability =
      super.buildObservability() as EmmettObservabilityConfig;

    const { pollTracing, includeMessagePayloads } =
      this.getConfig() as EmmettInstrumentationConfig;
    if (pollTracing !== undefined) observability.pollTracing = pollTracing;
    if (includeMessagePayloads !== undefined)
      observability.includeMessagePayloads = includeMessagePayloads;

    return observability;
  }
}
