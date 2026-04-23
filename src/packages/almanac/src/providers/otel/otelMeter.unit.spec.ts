import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { otelMeter } from './otelMeter';

describe('otelMeter', () => {
  const exporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });

  beforeAll(() => {
    metrics.setGlobalMeterProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
  });

  async function collectMetrics() {
    await reader.forceFlush();
    return exporter.getMetrics();
  }

  it('counter.add creates an OTel counter and calls add', async () => {
    const meter = otelMeter('test-counter');
    meter.counter('requests.total').add(5, { service: 'api' });

    const collected = await collectMetrics();
    const metric = collected
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .find((m) => m.descriptor.name === 'requests.total');

    expect(metric).toBeDefined();
  });

  it('histogram.record creates an OTel histogram and calls record', async () => {
    const meter = otelMeter('test-histogram');
    meter.histogram('request.duration').record(150, { endpoint: '/health' });

    const collected = await collectMetrics();
    const metric = collected
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .find((m) => m.descriptor.name === 'request.duration');

    expect(metric).toBeDefined();
  });

  it('gauge.record creates an OTel gauge and calls record', async () => {
    const meter = otelMeter('test-gauge');
    meter.gauge('queue.depth').record(42, { queue: 'events' });

    const collected = await collectMetrics();
    const metric = collected
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .find((m) => m.descriptor.name === 'queue.depth');

    expect(metric).toBeDefined();
  });
});
