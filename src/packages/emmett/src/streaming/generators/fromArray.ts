import { ReadableStream } from '@event-driven-io/emmett-shims';

export const fromArray = <T>(chunks: T[]) =>
  new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
