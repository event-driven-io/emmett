import { describe, it } from 'vitest';
import { assertThrows } from '../testing/assertions';
import { operationResult } from './utils';

void describe('inMemoryDatabase utils', () => {
  void it('operation result should throw an error when not successful', () => {
    assertThrows(() => {
      operationResult(
        {
          successful: false,
        },
        {
          collectionName: 'test',
          operationName: 'test',
          errors: { throwOnOperationFailures: true },
        },
      );
    });
  });
});
