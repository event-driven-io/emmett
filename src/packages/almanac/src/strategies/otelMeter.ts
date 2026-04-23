import { metrics } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import type { Meter } from '../meter';

export const otelMeter = (meterName = 'almanac'): Meter => {
  const meter = metrics.getMeter(meterName);
  return {
    counter: (name) => {
      const counter = meter.createCounter(name);
      return { add: (value, attrs) => counter.add(value, attrs as Attributes) };
    },
    histogram: (name) => {
      const histogram = meter.createHistogram(name);
      return {
        record: (value, attrs) => histogram.record(value, attrs as Attributes),
      };
    },
    gauge: (name) => {
      const gauge = meter.createGauge(name);
      return {
        record: (value, attrs) => gauge.record(value, attrs as Attributes),
      };
    },
  };
};
