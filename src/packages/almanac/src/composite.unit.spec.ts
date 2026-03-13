import { describe, expect, it } from 'vitest';
import { compositeTracer, compositeMeter } from './composite';
import { collectingTracer, collectingMeter } from './testing';

describe('compositeTracer', () => {
  it('calls startSpan on all inner tracers and returns the function result', async () => {
    const t1 = collectingTracer();
    const t2 = collectingTracer();

    const result = await compositeTracer(t1, t2).startSpan('test', () =>
      Promise.resolve(42),
    );

    expect(result).toBe(42);
    expect(t1.spans.map((s) => s.name)).toContain('test');
    expect(t2.spans.map((s) => s.name)).toContain('test');
  });

  it('propagates errors from the wrapped function', async () => {
    const t1 = collectingTracer();
    const t2 = collectingTracer();

    await expect(
      compositeTracer(t1, t2).startSpan('test', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');
  });

  it('with zero tracers, behaves as noop', async () => {
    const result = await compositeTracer().startSpan('test', () =>
      Promise.resolve(42),
    );
    expect(result).toBe(42);
  });
});

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
