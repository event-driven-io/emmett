import { AlmanacInstrumentation } from '@event-driven-io/almanac/otel';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import {
  currentDefaultObservability,
  setupObservability,
} from '../defaultObservability';
import type { EmmettObservabilityConfig, PollTracing } from '../options';

const EMMETT_INSTRUMENTATION_VERSION = '0.43.0-beta.27';

export interface EmmettInstrumentationConfig extends InstrumentationConfig {
  pollTracing?: PollTracing;
  includeMessagePayloads?: boolean;
}

export class EmmettInstrumentation extends AlmanacInstrumentation<
  EmmettObservabilityConfig,
  EmmettInstrumentationConfig
> {
  constructor(config: EmmettInstrumentationConfig = {}) {
    super('@event-driven-io/emmett', EMMETT_INSTRUMENTATION_VERSION, config);
  }

  protected buildObservability(): EmmettObservabilityConfig {
    const observability: EmmettObservabilityConfig =
      this.almanacObservability();

    const { pollTracing, includeMessagePayloads } = this.getConfig();
    if (pollTracing !== undefined) observability.pollTracing = pollTracing;
    if (includeMessagePayloads !== undefined)
      observability.includeMessagePayloads = includeMessagePayloads;

    return observability;
  }

  protected readObservability(): EmmettObservabilityConfig | undefined {
    return currentDefaultObservability();
  }

  protected setupObservability(
    observability: EmmettObservabilityConfig | undefined,
  ): void {
    if (observability === undefined) setupObservability(undefined);
    else setupObservability(observability);
  }
}
