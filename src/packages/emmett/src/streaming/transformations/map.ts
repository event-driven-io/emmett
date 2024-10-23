import { TransformStream } from 'web-streams-polyfill';

export const map = <From, To>(map: (item: From) => To) =>
  new TransformStream<From, To>({
    transform(chunk, controller) {
      controller.enqueue(map(chunk));
    },
  });
