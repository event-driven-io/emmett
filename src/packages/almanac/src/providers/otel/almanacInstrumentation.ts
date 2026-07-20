import type { MeterProvider, TracerProvider } from '@opentelemetry/api';
import {
  InstrumentationBase,
  type InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import type { AttributeTarget } from '../../attributes';
import {
  currentDefaultObservability,
  setupObservability,
  type Observability,
  type Sampler,
} from '../../configuration';
import type { TracePropagation } from '../../tracers';
import { otelLogger } from './otelLogger';
import { otelMeter } from './otelMeter';
import { otelTracer } from './otelTracer';

const ALMANAC_INSTRUMENTATION_NAME = '@event-driven-io/almanac';
const ALMANAC_INSTRUMENTATION_VERSION = '0.1.0-beta.31';

export type AlmanacObservabilityConfig = Partial<Observability<string>>;

export interface AlmanacInstrumentationConfig extends InstrumentationConfig {
  tracerName?: string;
  attributePrefix?: string;
  attributeTarget?: AttributeTarget;
  propagation?: TracePropagation;
  sampler?: Sampler;
}

export class AlmanacInstrumentation extends InstrumentationBase<AlmanacInstrumentationConfig> {
  // Declared without initializer so the base constructor's enable() call is not
  // clobbered by field initialization running after super().
  declare private previousObservability: AlmanacObservabilityConfig | undefined;
  declare private observabilityRegistered: boolean;

  constructor(config?: AlmanacInstrumentationConfig);
  constructor(
    instrumentationName: string,
    instrumentationVersion: string,
    config?: AlmanacInstrumentationConfig,
  );
  constructor(
    instrumentationNameOrConfig?: string | AlmanacInstrumentationConfig,
    instrumentationVersion?: string,
    config?: AlmanacInstrumentationConfig,
  ) {
    if (typeof instrumentationNameOrConfig === 'string') {
      super(instrumentationNameOrConfig, instrumentationVersion!, config ?? {});
    } else {
      super(
        instrumentationNameOrConfig?.tracerName ?? ALMANAC_INSTRUMENTATION_NAME,
        ALMANAC_INSTRUMENTATION_VERSION,
        instrumentationNameOrConfig ?? {},
      );
    }
  }

  protected init(): [] {
    return [];
  }

  public override enable(): void {
    if (this.observabilityRegistered) {
      setupObservability(this.buildObservability());
      return;
    }

    this.previousObservability = currentDefaultObservability();
    this.observabilityRegistered = true;
    setupObservability(this.buildObservability());
  }

  public override disable(): void {
    if (!this.observabilityRegistered) return;

    if (this.previousObservability === undefined) setupObservability(undefined);
    else setupObservability(this.previousObservability);
    this.previousObservability = undefined;
    this.observabilityRegistered = false;
  }

  public override setTracerProvider(tracerProvider: TracerProvider): void {
    super.setTracerProvider(tracerProvider);
    this.rebindObservability();
  }

  public override setMeterProvider(meterProvider: MeterProvider): void {
    super.setMeterProvider(meterProvider);
    this.rebindObservability();
  }

  protected buildObservability(): AlmanacObservabilityConfig {
    const config = this.getConfig();

    const observability: AlmanacObservabilityConfig = {
      tracer: otelTracer(this.instrumentationName, { tracer: this.tracer }),
      meter: otelMeter(this.instrumentationName),
      logger: otelLogger({ name: this.instrumentationName }),
    };

    if (config.propagation !== undefined)
      observability.propagation = config.propagation;
    if (config.attributeTarget !== undefined)
      observability.attributeTarget = config.attributeTarget;
    if (config.attributePrefix !== undefined)
      observability.attributePrefix = config.attributePrefix;
    if (config.sampler !== undefined) observability.sampler = config.sampler;

    return observability;
  }

  private rebindObservability(): void {
    if (this.observabilityRegistered)
      setupObservability(this.buildObservability());
  }
}
