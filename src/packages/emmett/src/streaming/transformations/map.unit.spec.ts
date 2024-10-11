import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { fromArray } from '../generators/fromArray';
import { map } from './map';

void describe('map transform', () => {
  void it('transforms numbers', async () => {
    const sourceStream = fromArray([1, 2, 3, 4]);

    const result = await collect(sourceStream.pipeThrough(map((x) => x * x)));

    assertDeepEqual(result, [1, 4, 9, 16]);
  });

  void it('transforms strings', async () => {
    const sourceStream = fromArray(['a', 'b', 'c']);

    const result = await collect(
      sourceStream.pipeThrough(map((str) => str.toUpperCase())),
    );

    assertDeepEqual(result, ['A', 'B', 'C']);
  });

  void it('transforms objects', async () => {
    const sourceStream = fromArray([{ x: 1 }, { x: 2 }, { x: 3 }]);

    const result = await collect(
      sourceStream.pipeThrough(
        map(({ x }) => ({ x: x * 2, str: x.toString() })),
      ),
    );

    assertDeepEqual(result, [
      { x: 2, str: '1' },
      { x: 4, str: '2' },
      { x: 6, str: '3' },
    ]);
  });

  void it('handles an empty input stream', async () => {
    const sourceStream = fromArray<{ x: number }>([]);

    const result = await collect(
      sourceStream.pipeThrough(
        map(({ x }) => ({ x: x * 2, str: x.toString() })),
      ),
    );

    assertDeepEqual(result, []);
  });

  void it('handle a single element input stream', async () => {
    const sourceStream = fromArray([5]);

    const result = await collect(sourceStream.pipeThrough(map((x) => x * x)));

    assertDeepEqual(result, [25]);
  });
});
