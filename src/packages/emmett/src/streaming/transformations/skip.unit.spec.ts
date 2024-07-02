import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { streamGenerators } from '../generators';
import { skip } from './skip';
const { fromArray } = streamGenerators;

void describe('SkipTransformStream', () => {
  void it('skips the first n items from the stream', async () => {
    const skipCount = 5;

    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, [6, 7, 8, 9, 10]);
  });

  void it('skips all items if skip is bigger than items count', async () => {
    const skipCount = 11;
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []);
  });

  void it('skips all items if skip is equal to items count', async () => {
    const skipCount = 10;
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []);
  });

  void it('handles an empty stream for skip', async () => {
    const skipCount = 5;
    const sourceStream = fromArray([]);

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []); // Should be empty for an empty stream
  });
});
