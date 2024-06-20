import { describe, it } from 'node:test';
import { ReadableStream } from 'web-streams-polyfill';
import { collect } from './collect';
import { assertDeepEqual } from '../../testing';

void describe('Stream Utility Functions', () => {
  void describe('collectStream', () => {
    void it('should collect all items from the stream', async () => {
      const items = [1, 2, 3];
      const stream = new ReadableStream({
        start(controller) {
          items.forEach((item) => controller.enqueue(item));
          controller.close();
        },
      });

      const result = await collect(stream);
      assertDeepEqual(result, items);
    });

    void it('handles an empty stream', async () => {
      const stream = new ReadableStream<number>({
        start(controller) {
          controller.close();
        },
      });

      const result = await collect(stream);
      assertDeepEqual(result, []);
    });
  });
});
