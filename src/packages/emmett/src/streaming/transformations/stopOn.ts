import { TransformStream } from 'web-streams-polyfill';

export const stopOn = <Item>(stopCondition: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    transform(chunk, controller) {
      if (!stopCondition(chunk)) {
        controller.enqueue(chunk);
        return;
      }
      controller.terminate();
    },
  });
