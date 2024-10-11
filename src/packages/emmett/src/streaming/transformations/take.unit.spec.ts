import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { fromArray } from '../generators/fromArray';
import { take } from './take';

void describe('TakeTransformStream', () => {
  void it('takes the first n items from the stream', async () => {
    const takeLimit = 5;
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(take(takeLimit)));

    assertDeepEqual(result, [1, 2, 3, 4, 5]);
  });

  void it('takes all items from the stream when items count is smaller than take limit', async () => {
    const takeLimit = 12;
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(take(takeLimit)));

    assertDeepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  void it('takes all items from the stream when items count is equal to take limit', async () => {
    const takeLimit = 10;
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(take(takeLimit)));

    assertDeepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  void it('handles an empty stream for take', async () => {
    const takeLimit = 5;
    const sourceStream = fromArray([]);

    const result = await collect(sourceStream.pipeThrough(take(takeLimit)));

    assertDeepEqual(result, []);
  });
});
