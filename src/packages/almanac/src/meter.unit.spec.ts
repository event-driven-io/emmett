import { describe, it } from 'vitest';
import { noopMeter } from './meter';

describe('noopMeter', () => {
  it('counter.add does not throw', () => {
    noopMeter().counter('test.count').add(1, { key: 'value' });
  });

  it('histogram.record does not throw', () => {
    noopMeter().histogram('test.duration').record(42, { status: 'success' });
  });

  it('gauge.record does not throw', () => {
    noopMeter().gauge('test.lag').record(10);
  });
});
