import { describe, it } from 'node:test';
import { assertThrows } from '../testing';
import { assertNotEmptyString } from './index';

void describe('Validation', () => {
  void describe('assertNotEmptyString', () => {
    void it('throws an error if the value is an empty string', () => {
      // Arrange
      const value = '';

      // Act
      const invalidAction = () => assertNotEmptyString(value);

      // Assert
      assertThrows(invalidAction);
    });
  });
});
