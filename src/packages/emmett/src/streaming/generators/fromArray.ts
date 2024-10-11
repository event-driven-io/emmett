import { ReadableStream } from 'web-streams-polyfill';

export const fromArray = <T>(chunks: T[]) =>
  new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
