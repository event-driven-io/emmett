export type Counter = {
  add(value: number, attributes?: Record<string, unknown>): void;
};

export type Histogram = {
  record(value: number, attributes?: Record<string, unknown>): void;
};

export type Gauge = {
  record(value: number, attributes?: Record<string, unknown>): void;
};

export type Meter = {
  counter(name: string): Counter;
  histogram(name: string): Histogram;
  gauge(name: string): Gauge;
};

const noMetrics: Meter = {
  counter: () => ({ add: () => {} }),
  histogram: () => ({ record: () => {} }),
  gauge: () => ({ record: () => {} }),
};

export const noopMeter = (): Meter => noMetrics;
