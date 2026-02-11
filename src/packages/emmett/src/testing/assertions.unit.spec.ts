import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSubset } from './assertions';

void describe('isSubset', () => {
  void it('should return true for matching flat objects', () => {
    assert.equal(isSubset({ a: 1, b: 'x' }, { a: 1, b: 'x' }), true);
  });

  void it('should return false when values differ', () => {
    assert.equal(isSubset({ a: 1, b: 'x' }, { a: 2, b: 'x' }), false);
  });

  void it('should return true when superObj has extra properties', () => {
    assert.equal(isSubset({ a: 1, b: 'x', c: 3 }, { a: 1 }), true);
  });

  void it('should handle null property values', () => {
    assert.equal(isSubset({ a: null, b: 'x' }, { a: null, b: 'x' }), true);
    assert.equal(isSubset({ a: 'y', b: 'x' }, { a: null, b: 'x' }), false);
    assert.equal(isSubset({ a: null, b: 'x' }, { a: 'y', b: 'x' }), false);
  });
});
