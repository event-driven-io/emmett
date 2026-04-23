import { describe, expect, it } from 'vitest';
import { collectingMeter } from '../testing';
import { compositeMeter } from './compositeMeter';

describe('compositeMeter', () => {
  it('counter.add calls add on all inner meters', () => {
    const m1 = collectingMeter();
    const m2 = collectingMeter();

    compositeMeter(m1, m2).counter('x').add(1);

    expect(m1.counters).toEqual([
      { name: 'x', value: 1, attributes: undefined },
    ]);
    expect(m2.counters).toEqual([
      { name: 'x', value: 1, attributes: undefined },
    ]);
  });
});
