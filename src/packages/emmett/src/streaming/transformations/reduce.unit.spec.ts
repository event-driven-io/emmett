import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { assertEqual } from '../../testing';
import { reduce } from './reduce'; // Adjust the import path

void describe('ReduceTransformStream', () => {
  void it('reduces numbers to their sum', async () => {
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 0;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const numbers = [1, 2, 3, 4, 5];
    const sourceStream = new ReadableStream<number>({
      start(controller) {
        for (const number of numbers) {
          controller.enqueue(number);
        }
        controller.close();
      },
    });

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 15);
  });

  void it('handles string concatenation', async () => {
    const reducer = (acc: string, chunk: string) => acc + chunk;
    const initialValue = '';
    const reduceStream = reduce<string, string>(reducer, initialValue);

    const strings = ['a', 'b', 'c', 'd'];
    const sourceStream = new ReadableStream<string>({
      start(controller) {
        for (const str of strings) {
          controller.enqueue(str);
        }
        controller.close();
      },
    });

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

    const objects = [{ count: 1 }, { count: 2 }, { count: 3 }];
    const sourceStream = new ReadableStream<Obj>({
      start(controller) {
        for (const obj of objects) {
          controller.enqueue(obj);
        }
        controller.close();
      },
    });

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assert.deepStrictEqual(value, { count: 6 });
  });

  void it('handles an empty stream', async () => {
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 12;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const sourceStream = new ReadableStream<number>({
      start(controller) {
        controller.close();
      },
    });

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 12);
  });

  void it('handles a stream with a single chunk', async () => {
    // Arrange
    const reducer = (acc: number, chunk: number) => acc + chunk;
    const initialValue = 12;
    const reduceStream = reduce<number, number>(reducer, initialValue);

    const sourceStream = new ReadableStream<number>({
      start(controller) {
        controller.enqueue(42);
        controller.close();
      },
    });

    const reader = sourceStream.pipeThrough(reduceStream).getReader();
    const { value } = await reader.read();

    assertEqual(value, 54);
  });
});
