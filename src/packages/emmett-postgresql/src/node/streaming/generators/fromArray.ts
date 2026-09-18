import { ReadableStream } from 'node:stream/web';

export const fromArray = <T>(chunks: T[]) =>
  new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
