/* eslint-disable @typescript-eslint/no-floating-promises */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { assertNotEmptyString } from './index';

describe('Validation', () => {
  describe('assertNotEmptyString', () => {
    test('should throw an error if the value is an empty string', () => {
      // Arrange
      const value = '';

      // Act
      const invalidAction = () => assertNotEmptyString(value);

      // Assert
      assert.throws(invalidAction);
    });
  });
});
