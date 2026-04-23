import { describe, expect, it } from 'vitest';
import { MessagingAttributes } from '@event-driven-io/almanac';
import { EmmettAttributes, EmmettMetrics } from './attributes';

const collectLeafValues = (obj: Record<string, unknown>): string[] => {
  const values: string[] = [];
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      values.push(value);
    } else if (typeof value === 'object' && value !== null) {
      values.push(...collectLeafValues(value as Record<string, unknown>));
    }
  }
  return values;
};

describe('EmmettAttributes', () => {
  it('all leaf values are prefixed with emmett.', () => {
    const values = collectLeafValues(EmmettAttributes);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^emmett\./);
    }
  });
});

describe('MessagingAttributes', () => {
  it('all values are prefixed with messaging.', () => {
    const values = collectLeafValues(MessagingAttributes);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^messaging\./);
    }
  });
});

describe('EmmettMetrics', () => {
  it('all leaf values are prefixed with emmett.', () => {
    const values = collectLeafValues(EmmettMetrics);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).toMatch(/^emmett\./);
    }
  });
});

describe('no duplicate values', () => {
  it('within EmmettAttributes', () => {
    const values = collectLeafValues(EmmettAttributes);
    expect(new Set(values).size).toBe(values.length);
  });

  it('within EmmettMetrics', () => {
    const values = collectLeafValues(EmmettMetrics);
    expect(new Set(values).size).toBe(values.length);
  });

  it('within MessagingAttributes', () => {
    const values = collectLeafValues(MessagingAttributes);
    expect(new Set(values).size).toBe(values.length);
  });
});
