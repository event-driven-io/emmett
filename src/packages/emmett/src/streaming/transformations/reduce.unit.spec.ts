import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assertEqual } from '../../testing';
import { fromArray } from '../generators/fromArray';
import { reduce } from './reduce'; // Adjust the import path

void describe('ReduceTransformStream', () => {
  void it('reduces numbers to their sum', async () => {
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 0;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const sourceStream = fromArray([1, 2, 3, 4, 5]);

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 15);
  });

  void it('handles string concatenation', async () => {
    const reducer = (acc: string, chunk: string) => acc + chunk;
    const initialValue = '';
    const reduceStream = reduce<string, string>(reducer, initialValue);

    const sourceStream = fromArray(['a', 'b', 'c', 'd']);

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 'abcd');
  });

  void it('works with complex objects', async () => {
    type Obj = { count: number };
    const reducer = (acc: Obj, chunk: Obj) => ({
      count: acc.count + chunk.count,
    });
    const initialValue = { count: 0 };
    const reduceStream = reduce<Obj, Obj>(reducer, initialValue);

    const sourceStream = fromArray([{ count: 1 }, { count: 2 }, { count: 3 }]);

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assert.deepStrictEqual(value, { count: 6 });
  });

  void it('handles an empty stream', async () => {
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 12;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const sourceStream = fromArray([]);

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 12);
  });

  void it('handles a stream with a single chunk', async () => {
    // Arrange
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 12;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const sourceStream = fromArray([42]);

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 54);
  });
});
