import { describe, expect, it } from 'vitest';
import { ObservabilitySpec } from './observabilitySpec';

describe('ObservabilitySpec', () => {
  it('awaits promise-like given setup before when', async () => {
    const given = ObservabilitySpec.for();

    await given(async () => ({ value: await Promise.resolve(41) }))
      .when(({ value }) => {
        expect(value).toBe(41);
      })
      .then(({ sut }) => {
        expect(sut.value).toBe(41);
      });
  });
});
