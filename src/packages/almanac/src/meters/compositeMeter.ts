import type { Counter, Gauge, Histogram, Meter } from './meter';

export const compositeMeter = (...meters: Meter[]): Meter => ({
  counter: (name: string): Counter => ({
    add: (value, attributes) =>
      meters.forEach((m) => m.counter(name).add(value, attributes)),
  }),
  histogram: (name: string): Histogram => ({
    record: (value, attributes) =>
      meters.forEach((m) => m.histogram(name).record(value, attributes)),
  }),
  gauge: (name: string): Gauge => ({
    record: (value, attributes) =>
      meters.forEach((m) => m.gauge(name).record(value, attributes)),
  }),
});
