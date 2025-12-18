import { describe, it, expect } from 'vitest';

describe('Browser test setup', () => {
  it('should run in browser environment', () => {
    expect(true).toBe(true);
  });
});
