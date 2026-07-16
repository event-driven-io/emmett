import type { MeterProvider, TracerProvider } from '@opentelemetry/api';
import {
  InstrumentationBase,
  type InstrumentationConfig,
} from '@opentelemetry/instrumentation';
import type { Observability } from '../../configuration';
import type { Logger } from '../../loggers';
import type { Meter } from '../../meters';
import type { Tracer } from '../../tracers';
import { otelLogger } from './otelLogger';
import { otelMeter } from './otelMeter';
import { otelTracer } from './otelTracer';

export type AlmanacObservabilityConfig = Partial<Observability<string>>;

export abstract class AlmanacInstrumentation<
  ObservabilityConfig extends AlmanacObservabilityConfig =
    AlmanacObservabilityConfig,
  ConfigType extends InstrumentationConfig = InstrumentationConfig,
> extends InstrumentationBase<ConfigType> {
  // Declared without initializer so the base constructor's enable() call is not
  // clobbered by field initialization running after super().
  declare private previousObservability: ObservabilityConfig | undefined;
  declare private observabilityRegistered: boolean;

  protected init(): [] {
    return [];
  }

  public override enable(): void {
    if (this.observabilityRegistered) {
      this.setupObservability(this.buildObservability());
      return;
    }

    this.previousObservability = this.readObservability();
    this.observabilityRegistered = true;
    this.setupObservability(this.buildObservability());
  }

  public override disable(): void {
    if (!this.observabilityRegistered) return;

    this.setupObservability(this.previousObservability);
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

  protected almanacObservability(): {
    tracer: Tracer;
    meter: Meter;
    logger: Logger;
  } {
    return {
      tracer: otelTracer(this.instrumentationName, { tracer: this.tracer }),
      meter: otelMeter(),
      logger: otelLogger(),
    };
  }

  private rebindObservability(): void {
    if (this.observabilityRegistered)
      this.setupObservability(this.buildObservability());
  }

  protected abstract buildObservability(): ObservabilityConfig;

  protected abstract readObservability(): ObservabilityConfig | undefined;

  protected abstract setupObservability(
    observability: ObservabilityConfig | undefined,
  ): void;
}
