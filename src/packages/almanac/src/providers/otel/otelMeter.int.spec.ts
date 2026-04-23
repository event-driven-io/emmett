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

  async function flush() {
    await reader.forceFlush();
    return exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics);
  }

  it('records command handling metrics with correct values and attributes', async () => {
    const meter = otelMeter('almanac-integration');

    meter
      .histogram('command.handling.duration')
      .record(34, { 'command.status': 'success' });
    meter
      .counter('event.appending.count')
      .add(2, { 'event.type': 'OrderPlaced' });
    meter
      .counter('event.appending.count')
      .add(1, { 'event.type': 'InventoryReserved' });

    const collected = await flush();
    const names = collected.map((m) => m.descriptor.name);
    expect(names).toContain('command.handling.duration');
    expect(names).toContain('event.appending.count');

    type HistogramValue = { count: number; sum: number };
    const duration = collected.find(
      (m) => m.descriptor.name === 'command.handling.duration',
    )!;
    expect((duration.dataPoints[0]!.value as HistogramValue).count).toBe(1);
    expect((duration.dataPoints[0]!.value as HistogramValue).sum).toBe(34);
    expect(duration.dataPoints[0]!.attributes['command.status']).toBe(
      'success',
    );

    const appendCount = collected.find(
      (m) => m.descriptor.name === 'event.appending.count',
    )!;
    const total = appendCount.dataPoints.reduce(
      (acc, dp) => acc + (dp.value as number),
      0,
    );
    expect(total).toBe(3);
  });

  it('records processor metrics: processing duration histogram and lag gauge', async () => {
    const meter = otelMeter('almanac-integration');

    meter.histogram('processor.processing.duration').record(12, {
      'processor.id': 'orders-processor',
      'processor.type': 'projector',
      'processor.status': 'success',
    });
    meter.histogram('processor.processing.duration').record(8, {
      'processor.id': 'orders-processor',
      'processor.type': 'projector',
      'processor.status': 'success',
    });
    meter
      .gauge('processor.lag_events')
      .record(42, { 'processor.id': 'orders-processor' });

    const collected = await flush();

    type HistogramValue = { count: number; sum: number };
    const duration = collected.find(
      (m) => m.descriptor.name === 'processor.processing.duration',
    )!;
    expect(duration).toBeDefined();
    const totalCount = duration.dataPoints.reduce(
      (acc, dp) => acc + (dp.value as HistogramValue).count,
      0,
    );
    expect(totalCount).toBe(2);
    const totalSum = duration.dataPoints.reduce(
      (acc, dp) => acc + (dp.value as HistogramValue).sum,
      0,
    );
    expect(totalSum).toBe(20);

    const lag = collected.find(
      (m) => m.descriptor.name === 'processor.lag_events',
    )!;
    expect(lag).toBeDefined();
    expect(lag.dataPoints[0]!.value).toBe(42);
    expect(lag.dataPoints[0]!.attributes['processor.id']).toBe(
      'orders-processor',
    );
  });

  it('records stream read and append metrics with size tracking', async () => {
    const meter = otelMeter('almanac-integration');

    meter.histogram('stream.reading.duration').record(5, {
      'stream.name': 'orders',
      'eventstore.read.status': 'success',
    });
    meter.counter('event.reading.count').add(10, { 'stream.name': 'orders' });
    meter.histogram('stream.appending.duration').record(3, {
      'stream.name': 'orders',
      'eventstore.append.status': 'success',
    });
    meter
      .counter('event.appending.count')
      .add(1, { 'event.type': 'OrderPlaced' });

    const collected = await flush();
    const names = collected.map((m) => m.descriptor.name);
    expect(names).toContain('stream.reading.duration');
    expect(names).toContain('event.reading.count');
    expect(names).toContain('stream.appending.duration');
    expect(names).toContain('event.appending.count');

    type HistogramValue = { count: number; sum: number };
    const readDuration = collected.find(
      (m) => m.descriptor.name === 'stream.reading.duration',
    )!;
    expect((readDuration.dataPoints[0]!.value as HistogramValue).sum).toBe(5);
    expect(
      readDuration.dataPoints[0]!.attributes['eventstore.read.status'],
    ).toBe('success');

    const readCount = collected.find(
      (m) => m.descriptor.name === 'event.reading.count',
    )!;
    expect(readCount.dataPoints[0]!.value).toBe(10);
    expect(readCount.dataPoints[0]!.attributes['stream.name']).toBe('orders');
  });
});
