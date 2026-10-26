import * as almanac from '@event-driven-io/almanac';
import { describe, expect, it } from 'vitest';
import * as emmett from '../index';

describe('emmett observability exports', () => {
  it('include every almanac value', () => {
    const missing = Object.keys(almanac).filter((name) => !(name in emmett));

    expect(missing).toEqual([]);
  });
});
