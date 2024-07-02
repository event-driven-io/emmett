import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { fromArray } from '../generators/fromArray';
import { collect } from './collect';

void describe('Stream Utility Functions', () => {
  void describe('collectStream', () => {
    void it('should collect all items from the stream', async () => {
      const items = [1, 2, 3];
      const stream = fromArray(items);

      const result = await collect(stream);
      assertDeepEqual(result, items);
    });

    void it('handles an empty stream', async () => {
      const stream = fromArray([]);

      const result = await collect(stream);
      assertDeepEqual(result, []);
    });
  });
});
