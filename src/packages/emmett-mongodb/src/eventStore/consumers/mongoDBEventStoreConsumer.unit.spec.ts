import { describe, it } from 'node:test';
import { filterMessagesByType } from './mongoDBEventStoreConsumer';
import { assertEqual, assertThatArray } from 'packages/emmett/src';

describe('MongoDBEventStoreConsumer', () => {
  describe('filterMessagesByType', () => {
    it('should filter for the correct messages types', () => {
      const messages = [
        { type: 'ProductItemAdded', data: {} },
        { type: 'DiscountApplied', data: {} },
        { type: 'ProductItemAdded', data: {} },
        { type: 'DiscountApplied', data: {} },
      ];
      const types = ['ProductItemAdded'];
      const result = filterMessagesByType(messages, types);
      assertEqual(2, result.length);
      assertThatArray(result).allMatch((m) => m.type === 'ProductItemAdded');
    });
  });
});
