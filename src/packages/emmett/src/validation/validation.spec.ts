import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertNotEmptyString } from './index';

void describe('Validation', () => {
  void describe('assertNotEmptyString', () => {
    void it('should throw an error if the value is an empty string', () => {
      // Arrange
      const value = '';

      // Act
      const invalidAction = () => assertNotEmptyString(value);

      // Assert
      assert.throws(invalidAction);
    });
  });
});
