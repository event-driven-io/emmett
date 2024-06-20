import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { assertDeepEqual } from '../../testing';
import { collect } from '../collectors/collect';
import { skip } from './skip';

void describe('SkipTransformStream', () => {
  void it('skips the first n items from the stream', async () => {
    const skipCount = 5;
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sourceStream = new ReadableStream<number>({
      start(controller) {
        for (const item of data) {
          controller.enqueue(item);
        }
        controller.close();
      },
    });

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, [6, 7, 8, 9, 10]);
  });

  void it('skips all items if skip is bigger than items count', async () => {
    const skipCount = 11;
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sourceStream = new ReadableStream<number>({
      start(controller) {
        for (const item of data) {
          controller.enqueue(item);
        }
        controller.close();
      },
    });

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []);
  });

  void it('skips all items if skip is equal to items count', async () => {
    const skipCount = 10;
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sourceStream = new ReadableStream<number>({
      start(controller) {
        for (const item of data) {
          controller.enqueue(item);
        }
        controller.close();
      },
    });

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []);
  });

  void it('handles an empty stream for skip', async () => {
    const skipCount = 5;
    const sourceStream = new ReadableStream<number>({
      start(controller) {
        controller.close();
      },
    });

    const result = await collect(sourceStream.pipeThrough(skip(skipCount)));

    assertDeepEqual(result, []); // Should be empty for an empty stream
  });
});
