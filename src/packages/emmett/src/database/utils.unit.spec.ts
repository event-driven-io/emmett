import { describe, it } from 'node:test';
import { operationResult } from './utils';
import assert from 'node:assert/strict';

void describe('inMemoryDatabase utils', () => {
  void it('operation result should throw an error when not successful', () => {
    assert.throws(() => {
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
