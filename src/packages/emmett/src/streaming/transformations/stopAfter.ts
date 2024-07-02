import { TransformStream } from '@event-driven-io/emmett-shims';

export const stopAfter = <Item>(stopCondition: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      if (stopCondition(chunk)) {
        controller.terminate();
      }
    },
  });
