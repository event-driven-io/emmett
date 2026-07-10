import { describe, expect, it } from 'vitest';
import { mergeObservabilityOptions } from './options';

describe('mergeObservabilityOptions', () => {
  it('returns the original options when defaults are missing', () => {
    const options = {
      processorId: 'test',
      observability: { propagation: 'propagate' as const },
    };

    const result = mergeObservabilityOptions(options, undefined);

    expect(result).toBe(options);
  });
});
