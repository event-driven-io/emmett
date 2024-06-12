import { describe, it } from 'node:test';
import { assertNotEmptyString } from './index';
import { assertThrows } from '../testing';

void describe('Validation', () => {
  void describe('assertNotEmptyString', () => {
    void it('should throw an error if the value is an empty string', () => {
      // Arrange
      const value = '';

      // Act
      const invalidAction = () => assertNotEmptyString(value);

      // Assert
      assertThrows(invalidAction);
    });
  });
});
