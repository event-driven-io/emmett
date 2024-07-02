import { TransformStream } from 'web-streams-polyfill';

export const stopAfter = <Item>(stopCondition: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      if (stopCondition(chunk)) {
        controller.terminate();
      }
    },
  });
