import { describe, expect, it } from 'vitest';
import { noopLogger } from '../loggers';
import { noopMeter } from '../meters';
import { noopTracer } from '../tracers';
import { collectingMeter, collectingTracer } from '../testing';
import { DISABLED, type Observability } from './options';
import { mergeObservability, observability } from './observability';

const logger = () => {};

describe('observability', () => {
  it('can configure an application-specific observability namespace', () => {
    const configured: Observability<'emmett'> = observability();

    expect(configured).toEqual({
      tracer: noopTracer(),
      meter: noopMeter(),
      logger: noopLogger,
    });
  });

  it('keeps observability disabled by default', () => {
    expect(observability()).toEqual({
      tracer: noopTracer(),
      meter: noopMeter(),
      logger: noopLogger,
    });
  });

  it('supports logging without tracing or metrics', () => {
    expect(observability({ logging: logger })).toEqual({
      tracer: noopTracer(),
      meter: noopMeter(),
      logger,
    });
  });

  it('supports tracing without logging or metrics', () => {
    const tracer = collectingTracer();

    expect(observability({ tracing: tracer })).toEqual({
      tracer,
      meter: noopMeter(),
      logger: noopLogger,
    });
  });

  it('supports metrics without tracing or logging', () => {
    const meter = collectingMeter();

    expect(observability({ metrics: meter })).toEqual({
      tracer: noopTracer(),
      meter,
      logger: noopLogger,
    });
  });

  it('disables tracing without changing metrics or logging', () => {
    const meter = collectingMeter();

    expect(
      observability({ tracing: DISABLED, metrics: meter, logging: logger }),
    ).toEqual({
      tracer: noopTracer(),
      meter,
      logger,
    });
  });

  it('disables metrics without changing tracing or logging', () => {
    const tracer = collectingTracer();

    expect(
      observability({ tracing: tracer, metrics: DISABLED, logging: logger }),
    ).toEqual({
      tracer,
      meter: noopMeter(),
      logger,
    });
  });

  it('disables logging without changing tracing or metrics', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();

    expect(
      observability({ tracing: tracer, metrics: meter, logging: DISABLED }),
    ).toEqual({
      tracer,
      meter,
      logger: noopLogger,
    });
  });
});

describe('mergeObservability', () => {
  type ApplicationObservability = Partial<Observability<string>> & {
    pollTracing?: 'off' | 'active';
  };

  it('uses defaults when overrides are missing', () => {
    const defaults: ApplicationObservability = { pollTracing: 'active' };

    expect(mergeObservability(defaults, undefined)).toBe(defaults);
  });

  it('uses overrides when defaults are missing', () => {
    const overrides: ApplicationObservability = { pollTracing: 'off' };

    expect(mergeObservability(undefined, overrides)).toBe(overrides);
  });

  it('merges defaults with overrides taking precedence', () => {
    const defaults: ApplicationObservability = {
      logger,
      pollTracing: 'active',
    };
    const overrides: ApplicationObservability = { pollTracing: 'off' };

    expect(mergeObservability(defaults, overrides)).toEqual({
      logger,
      pollTracing: 'off',
    });
  });
});
