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

export const noopMeter = (): Meter => ({
  counter: () => ({ add: () => {} }),
  histogram: () => ({ record: () => {} }),
  gauge: () => ({ record: () => {} }),
});
