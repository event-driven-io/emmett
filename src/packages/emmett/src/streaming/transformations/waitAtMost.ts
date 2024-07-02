import streams from '@event-driven-io/emmett-shims';

export const waitAtMost = <Item>(waitTimeInMs: number) =>
  new streams.TransformStream<Item, Item>({
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
