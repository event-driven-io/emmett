import { TransformStream } from 'web-streams-polyfill';

export const stopOn = <Item>(stopCondition: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    async transform(chunk, controller) {
      if (!stopCondition(chunk)) {
        controller.enqueue(chunk);
        return;
      }
      await Promise.resolve();
      controller.terminate();
    },
  });
