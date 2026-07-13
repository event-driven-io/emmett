import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISABLED, observability } from '../../../configuration';
import { noopLogger } from '../../../loggers';
import { noopMeter } from '../../../meters';
import { collectingMeter, collectingTracer } from '../../../testing';
import { noopTracer } from '../../../tracers';
import { consoleLogger } from '../../console';
import type { OtelSDK } from '../otel';
import { otel } from './otelNode';

const nodeSDK = vi.hoisted(() => ({
  configurations: [] as Partial<NodeSDKConfiguration>[],
  shutdown: vi.fn<() => void>(),
  start: vi.fn<() => void>(),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class {
    constructor(configuration: Partial<NodeSDKConfiguration>) {
      nodeSDK.configurations.push(configuration);
    }

    start = nodeSDK.start;
    shutdown = nodeSDK.shutdown;
  },
  tracing: {
    NoopSpanProcessor: class {},
  },
}));

describe('Node OTel observability', () => {
  afterEach(async () => {
    process.emit('SIGTERM');
    await Promise.resolve();
    nodeSDK.configurations.length = 0;
    nodeSDK.shutdown.mockClear();
    nodeSDK.start.mockClear();
  });

  it('creates and starts NodeSDK with its standard defaults', () => {
    const configured = observability(
      otel({ serviceName: 'orders', autoDetectResources: false }),
    );

    expect(nodeSDK.configurations).toEqual([
      { serviceName: 'orders', autoDetectResources: false },
    ]);
    expect(nodeSDK.start).toHaveBeenCalledOnce();
    expect(configured.tracer).not.toBe(noopTracer());
    expect(configured.meter).not.toBe(noopMeter());
    expect(configured.logger).not.toBe(noopLogger);
  });

  it('accepts an externally configured NodeSDK', () => {
    const sdk = {
      start: vi.fn<() => void>(),
      shutdown: vi.fn<() => void>(),
    } satisfies OtelSDK;

    observability(otel({ sdk }));

    expect(nodeSDK.configurations).toEqual([]);
    expect(nodeSDK.start).not.toHaveBeenCalled();
    expect(sdk.start).toHaveBeenCalledOnce();
  });

  it('uses console logging without creating an OTel log exporter', () => {
    const configured = observability(
      otel({ serviceName: 'orders', logging: consoleLogger }),
    );

    expect(nodeSDK.configurations).toEqual([
      { serviceName: 'orders', logRecordProcessors: [] },
    ]);
    expect(configured.logger).toBe(consoleLogger);
    expect(configured.tracer).not.toBe(noopTracer());
    expect(configured.meter).not.toBe(noopMeter());
  });

  it('supports OTel logging without tracing or metrics', () => {
    const configured = observability(
      otel({ tracing: DISABLED, metrics: DISABLED }),
    );

    expect(nodeSDK.configurations).toEqual([
      {
        spanProcessors: [expect.anything()],
        metricReaders: [],
      },
    ]);
    expect(configured.tracer).toBe(noopTracer());
    expect(configured.meter).toBe(noopMeter());
    expect(configured.logger).not.toBe(noopLogger);
  });

  it('does not create NodeSDK when every OTel capability is replaced', () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();
    const logger = vi.fn();

    expect(
      observability(otel({ tracing: tracer, metrics: meter, logging: logger })),
    ).toEqual({ tracer, meter, logger });
    expect(nodeSDK.configurations).toEqual([]);
    expect(nodeSDK.start).not.toHaveBeenCalled();
  });

  it('does not create NodeSDK when every capability is disabled', () => {
    expect(
      observability(
        otel({
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
    expect(nodeSDK.configurations).toEqual([]);
    expect(nodeSDK.start).not.toHaveBeenCalled();
  });
});
