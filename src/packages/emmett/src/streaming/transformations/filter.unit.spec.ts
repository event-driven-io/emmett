import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { streamGenerators } from '../generators';
import { filter } from './filter';
const { fromArray } = streamGenerators;

void describe('filter transformation', () => {
  void it('leaves only matching items', async () => {
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(
      sourceStream.pipeThrough(filter((i) => i % 2 == 0)),
    );

    assertDeepEqual(result, [2, 4, 6, 8, 10]);
  });

  void it('leaves all if all are matching', async () => {
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(filter(() => true)));

    assertDeepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  void it('leaves nothing if none are matching', async () => {
    const sourceStream = fromArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = await collect(sourceStream.pipeThrough(filter(() => false)));

    assertDeepEqual(result, []);
  });

  void it('handles an empty stream', async () => {
    const sourceStream = fromArray([]);

    const result = await collect(sourceStream.pipeThrough(filter(() => true)));

    assertDeepEqual(result, []);
  });
});
