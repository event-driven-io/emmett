import { describe, expect, it } from 'vitest';
import { rateSample } from './options';

describe('rateSample', () => {
  it('rejects every sample when the rate is zero', () => {
    const sampler = rateSample(0);
    const results = Array.from({ length: 100 }, () =>
      sampler.shouldSample('test'),
    );
    expect(results.every((r) => r === false)).toBe(true);
  });

  it('accepts every sample when the rate is one', () => {
    const sampler = rateSample(1);
    const results = Array.from({ length: 100 }, () =>
      sampler.shouldSample('test'),
    );
    expect(results.every((r) => r === true)).toBe(true);
  });
});
