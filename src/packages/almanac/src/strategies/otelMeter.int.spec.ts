import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { otelMeter } from './otelMeter';

describe('otelMeter integration', () => {
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

  async function collectAndLog() {
    await reader.forceFlush();
    const collected = exporter.getMetrics();
    const summary = collected
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => ({
        name: m.descriptor.name,
        dataPoints: m.dataPoints,
      }));
    console.log(
      '\n--- Collected Metrics ---\n' + JSON.stringify(summary, null, 2),
    );
    return collected;
  }

  it('configure otelMeter and record counter, histogram, and gauge', async () => {
    const meter = otelMeter('almanac-integration');

    meter.counter('commands.total').add(1, { 'command.type': 'AddProduct' });
    meter
      .histogram('command.duration_ms')
      .record(42, { 'command.type': 'AddProduct' });
    meter.gauge('queue.depth').record(7, { queue: 'commands' });

    const collected = await collectAndLog();
    const names = collected
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);

    expect(names).toContain('commands.total');
    expect(names).toContain('command.duration_ms');
    expect(names).toContain('queue.depth');
  });

  it('realistic multi-metric scenario: process an event stream batch', async () => {
    const meter = otelMeter('almanac-integration');
    const processed = meter.counter('events.processed');
    const latency = meter.histogram('event.processing_ms');
    const backlog = meter.gauge('events.backlog');

    const events = [
      { id: 'e1', ms: 12 },
      { id: 'e2', ms: 8 },
      { id: 'e3', ms: 25 },
      { id: 'e4', ms: 5 },
      { id: 'e5', ms: 18 },
    ];

    for (const event of events) {
      processed.add(1, { 'event.type': 'OrderPlaced' });
      latency.record(event.ms, { 'event.type': 'OrderPlaced' });
    }

    backlog.record(events.length, { 'consumer.group': 'orders-consumer' });

    const collected = await collectAndLog();
    expect(collected.length).toBeGreaterThan(0);
  });
});
