import type { Counter, Gauge, Histogram, Meter } from '../meters';

export type CollectedCounter = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};
export type CollectedHistogram = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};
export type CollectedGauge = {
  name: string;
  value: number;
  attributes?: Record<string, unknown>;
};

export type CollectingMeter = Meter & {
  counters: CollectedCounter[];
  histograms: CollectedHistogram[];
  gauges: CollectedGauge[];
};

export const collectingMeter = (): CollectingMeter => {
  const counters: CollectedCounter[] = [];
  const histograms: CollectedHistogram[] = [];
  const gauges: CollectedGauge[] = [];

  return {
    counters,
    histograms,
    gauges,
    counter: (name: string): Counter => ({
      add: (value, attributes) => counters.push({ name, value, attributes }),
    }),
    histogram: (name: string): Histogram => ({
      record: (value, attributes) =>
        histograms.push({ name, value, attributes }),
    }),
    gauge: (name: string): Gauge => ({
      record: (value, attributes) => gauges.push({ name, value, attributes }),
    }),
  };
};
