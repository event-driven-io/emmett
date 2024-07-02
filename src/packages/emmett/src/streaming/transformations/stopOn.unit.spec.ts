import { describe, it } from 'node:test';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { fromArray } from '../generators/fromArray';
import { stopOn } from './stopOn';

void describe('stopOn transform', () => {
  void it('stops on a specific number', async () => {
    const sourceStream = fromArray([1, 2, 3, 4, 5]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((x) => x === 3)),
    );

    assertDeepEqual(result, [1, 2]);
  });

  void it('stops on a specific string', async () => {
    const sourceStream = fromArray(['a', 'b', 'c', 'd']);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((str) => str === 'c')),
    );

    assertDeepEqual(result, ['a', 'b']);
  });

  void it('stops on a condition with objects', async () => {
    const sourceStream = fromArray([{ x: 1 }, { x: 2 }, { x: 3 }]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn(({ x }) => x > 1)),
    );

    assertDeepEqual(result, [{ x: 1 }]);
  });

  void it('handles an empty input stream', async () => {
    const sourceStream = fromArray<number>([]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((x) => x === 3)),
    );

    assertDeepEqual(result, []);
  });

  void it('handles a single element input stream', async () => {
    const sourceStream = fromArray([5]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((x) => x === 3)),
    );

    assertDeepEqual(result, [5]);
  });

  void it('handles a single element that meets the stop condition', async () => {
    const sourceStream = fromArray([3]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((x) => x === 3)),
    );

    assertDeepEqual(result, []);
  });

  void it('handles no matching item in non-empty array', async () => {
    const sourceStream = fromArray([1, 2, 3, 4, 5]);

    const result = await collect(
      sourceStream.pipeThrough(stopOn((x) => x === 6)),
    );

    assertDeepEqual(result, [1, 2, 3, 4, 5]);
  });
});
