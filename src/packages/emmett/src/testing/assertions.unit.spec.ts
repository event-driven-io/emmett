import { describe, it } from 'vitest';
import { assertFalse, assertTrue, isSubset } from './assertions';

void describe('isSubset', () => {
  void it('should return true for matching flat objects', () => {
    assertTrue(isSubset({ a: 1, b: 'x' }, { a: 1, b: 'x' }));
  });

  void it('should return false when values differ', () => {
    assertFalse(isSubset({ a: 1, b: 'x' }, { a: 2, b: 'x' }));
  });

  void it('should return true when superObj has extra properties', () => {
    assertTrue(isSubset({ a: 1, b: 'x', c: 3 }, { a: 1 }));
  });

  void it('should handle null property values', () => {
    assertTrue(isSubset({ a: null, b: 'x' }, { a: null, b: 'x' }));
    assertFalse(isSubset({ a: 'y', b: 'x' }, { a: null, b: 'x' }));
    assertFalse(isSubset({ a: null, b: 'x' }, { a: 'y', b: 'x' }));
  });
});
