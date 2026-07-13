import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISABLED, observability } from '../../configuration';
import { consoleLogger } from '../console';
import { noopLogger } from '../../loggers';
import { noopMeter } from '../../meters';
import { collectingMeter, collectingTracer } from '../../testing';
import { noopTracer } from '../../tracers';
import { otel, type OtelSDK } from './otel';

const sdk = () =>
  ({
    start: vi.fn<() => void>(),
    shutdown: vi.fn<() => void>(),
  }) satisfies OtelSDK;

describe('otel', () => {
  afterEach(async () => {
    process.emit('SIGTERM');
    await Promise.resolve();
  });

  it('starts the SDK when OTel observability is selected', () => {
    const instance = sdk();

    observability(otel({ sdk: instance }));

    expect(instance.start).toHaveBeenCalledOnce();
  });

  it('starts an owned SDK once when its configuration is reused', () => {
    const instance = sdk();
    const openTelemetry = otel({ sdk: instance });

    observability(openTelemetry);
    observability(openTelemetry);

    expect(instance.start).toHaveBeenCalledOnce();
  });

  it('supports OTel tracing and metrics with console logging', () => {
    const instance = sdk();

    const configured = observability(
      otel({ sdk: instance, logging: consoleLogger }),
    );

    expect(configured.logger).toBe(consoleLogger);
    expect(configured.tracer).not.toBe(noopTracer());
    expect(configured.meter).not.toBe(noopMeter());
    expect(instance.start).toHaveBeenCalledOnce();
  });

  it('supports OTel logging without tracing or metrics', () => {
    const instance = sdk();

    const configured = observability(
      otel({ sdk: instance, tracing: DISABLED, metrics: DISABLED }),
    );

    expect(configured.tracer).toBe(noopTracer());
    expect(configured.meter).toBe(noopMeter());
    expect(configured.logger).not.toBe(noopLogger);
    expect(instance.start).toHaveBeenCalledOnce();
  });

  it('supports OTel tracing without metrics or logging', () => {
    const instance = sdk();

    const configured = observability(
      otel({ sdk: instance, metrics: DISABLED, logging: DISABLED }),
    );

    expect(configured.tracer).not.toBe(noopTracer());
    expect(configured.meter).toBe(noopMeter());
    expect(configured.logger).toBe(noopLogger);
    expect(instance.start).toHaveBeenCalledOnce();
  });

  it('supports console logging without starting an unused OTel SDK', () => {
    const instance = sdk();

    const configured = observability(
      otel({
        sdk: instance,
        tracing: DISABLED,
        metrics: DISABLED,
        logging: consoleLogger,
      }),
    );

    expect(configured).toEqual({
      tracer: noopTracer(),
      meter: noopMeter(),
      logger: consoleLogger,
    });
    expect(instance.start).not.toHaveBeenCalled();
  });

  it('does not start the SDK when every OTel capability is replaced', () => {
    const instance = sdk();
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const logger = vi.fn();

    expect(
      observability(
        otel({
          sdk: instance,
          tracing: tracer,
          metrics: meter,
          logging: logger,
        }),
      ),
    ).toEqual({ tracer, meter, logger });
    expect(instance.start).not.toHaveBeenCalled();
  });

  it('does not start the SDK when every OTel capability is disabled', () => {
    const instance = sdk();

    expect(
      observability(
        otel({
          sdk: instance,
          tracing: DISABLED,
          metrics: DISABLED,
          logging: DISABLED,
        }),
      ),
    ).toEqual({
      tracer: noopTracer(),
      meter: noopMeter(),
      logger: noopLogger,
    });
    expect(instance.start).not.toHaveBeenCalled();
  });

  it('shuts down the SDK once when the process stops', async () => {
    const instance = sdk();
    observability(otel({ sdk: instance }));

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(instance.shutdown).toHaveBeenCalledOnce());

    process.emit('SIGTERM');
    await Promise.resolve();

    expect(instance.shutdown).toHaveBeenCalledOnce();
  });
});
