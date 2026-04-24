import type {
  CollectedCounter,
  CollectedGauge,
  CollectedHistogram,
  CollectingMeter,
} from './collectingMeter';

type CollectedEntry = {
  value: number;
  attributes?: Record<string, unknown>;
};

type CounterAssertions = {
  hasValue(value: number): CounterAssertions;
  recordedTimes(n: number): CounterAssertions;
  recordedValues(values: number[]): CounterAssertions;
  hasAttribute(key: string, value: unknown): CounterAssertions;
  hasAttributes(attrs: Record<string, unknown>): CounterAssertions;
};

type HistogramAssertions = {
  hasValue(value: number): HistogramAssertions;
  hasValueAtLeast(min: number): HistogramAssertions;
  recordedTimes(n: number): HistogramAssertions;
  recordedValues(values: number[]): HistogramAssertions;
  hasAttribute(key: string, value: unknown): HistogramAssertions;
  hasAttributes(attrs: Record<string, unknown>): HistogramAssertions;
};

type GaugeAssertions = {
  hasValue(value: number): GaugeAssertions;
  recordedTimes(n: number): GaugeAssertions;
  recordedValues(values: number[]): GaugeAssertions;
  hasAttribute(key: string, value: unknown): GaugeAssertions;
  hasAttributes(attrs: Record<string, unknown>): GaugeAssertions;
};

export type MeterCollectionAssertions = {
  haveCounterNamed(name: string): CounterAssertions;
  haveHistogramNamed(name: string): HistogramAssertions;
  haveGaugeNamed(name: string): GaugeAssertions;
};

const assertAttribute = (
  kind: string,
  name: string,
  attributes: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
) => {
  const actual = attributes?.[key];
  const isEqual =
    Array.isArray(value) || (typeof value === 'object' && value !== null)
      ? JSON.stringify(actual) === JSON.stringify(value)
      : actual === value;
  if (!isEqual)
    throw new Error(
      `Expected ${kind} "${name}" attribute "${key}" to be ${JSON.stringify(value)}, got ${JSON.stringify(actual)}.\nExisting attributes: ${JSON.stringify(attributes ?? {}, null, 2)}`,
    );
};

const metricsAssertions = <Self>(
  kind: string,
  name: string,
  entries: CollectedEntry[],
  self: () => Self,
) => ({
  recordedTimes(n: number): Self {
    if (entries.length !== n)
      throw new Error(
        `Expected ${kind} "${name}" to be recorded ${n} time(s), got ${entries.length}`,
      );
    return self();
  },
  recordedValues(values: number[]): Self {
    const actual = entries.map((e) => e.value);
    if (JSON.stringify(actual) !== JSON.stringify(values))
      throw new Error(
        `Expected ${kind} "${name}" recorded values to be ${JSON.stringify(values)}, got ${JSON.stringify(actual)}`,
      );
    return self();
  },
  hasAttribute(key: string, value: unknown): Self {
    const entry = entries[0];
    if (!entry)
      throw new Error(
        `Expected ${kind} "${name}" to exist but it was not recorded`,
      );
    assertAttribute(kind, name, entry.attributes, key, value);
    return self();
  },
  hasAttributes(attrs: Record<string, unknown>): Self {
    for (const [key, value] of Object.entries(attrs))
      assertAttribute(kind, name, entries[0]?.attributes, key, value);
    return self();
  },
});

const assertThatCounter = (
  entries: CollectedCounter[],
  name: string,
): CounterAssertions => {
  const self: CounterAssertions = {
    hasValue(value) {
      const total = entries.reduce((sum, e) => sum + e.value, 0);
      if (total !== value)
        throw new Error(
          `Expected counter "${name}" total value to be ${value}, got ${total} (across ${entries.length} recording(s))`,
        );
      return self;
    },
    ...metricsAssertions('counter', name, entries, () => self),
  };
  return self;
};

const assertThatHistogram = (
  entries: CollectedHistogram[],
  name: string,
): HistogramAssertions => {
  const self: HistogramAssertions = {
    hasValue(value) {
      const entry = entries[0];
      if (!entry)
        throw new Error(
          `Expected histogram "${name}" to exist but it was not recorded`,
        );
      if (entry.value !== value)
        throw new Error(
          `Expected histogram "${name}" value to be ${value}, got ${entry.value}`,
        );
      return self;
    },
    hasValueAtLeast(min) {
      const entry = entries[0];
      if (!entry)
        throw new Error(
          `Expected histogram "${name}" to exist but it was not recorded`,
        );
      if (entry.value < min)
        throw new Error(
          `Expected histogram "${name}" value to be >= ${min}, got ${entry.value}`,
        );
      return self;
    },
    ...metricsAssertions('histogram', name, entries, () => self),
  };
  return self;
};

const assertThatGauge = (
  entries: CollectedGauge[],
  name: string,
): GaugeAssertions => {
  const self: GaugeAssertions = {
    hasValue(value) {
      const entry = entries[0];
      if (!entry)
        throw new Error(
          `Expected gauge "${name}" to exist but it was not recorded`,
        );
      if (entry.value !== value)
        throw new Error(
          `Expected gauge "${name}" value to be ${value}, got ${entry.value}`,
        );
      return self;
    },
    ...metricsAssertions('gauge', name, entries, () => self),
  };
  return self;
};

export const assertThatMetrics = (
  meter: CollectingMeter,
): MeterCollectionAssertions => ({
  haveCounterNamed(name) {
    const entries = meter.counters.filter((c) => c.name === name);
    if (entries.length === 0)
      throw new Error(
        `Expected counter named "${name}" but found: [${[...new Set(meter.counters.map((c) => c.name))].join(', ')}]`,
      );
    return assertThatCounter(entries, name);
  },
  haveHistogramNamed(name) {
    const entries = meter.histograms.filter((h) => h.name === name);
    if (entries.length === 0)
      throw new Error(
        `Expected histogram named "${name}" but found: [${[...new Set(meter.histograms.map((h) => h.name))].join(', ')}]`,
      );
    return assertThatHistogram(entries, name);
  },
  haveGaugeNamed(name) {
    const entries = meter.gauges.filter((g) => g.name === name);
    if (entries.length === 0)
      throw new Error(
        `Expected gauge named "${name}" but found: [${[...new Set(meter.gauges.map((g) => g.name))].join(', ')}]`,
      );
    return assertThatGauge(entries, name);
  },
});
