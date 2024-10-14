import { TransformStream } from 'web-streams-polyfill';

export const waitAtMost = <Item>(waitTimeInMs: number) =>
  new TransformStream<Item, Item>({
    start(controller) {
      const timeoutId = setTimeout(() => {
        controller.terminate();
      }, waitTimeInMs);

      const originalTerminate = controller.terminate.bind(controller);

      // Clear the timeout if the stream is terminated early
      controller.terminate = () => {
        clearTimeout(timeoutId);
        originalTerminate();
      };
    },
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });
