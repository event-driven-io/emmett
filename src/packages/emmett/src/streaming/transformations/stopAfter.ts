import streams from '@event-driven-io/emmett-shims';

export const stopAfter = <Item>(stopCondition: (item: Item) => boolean) =>
  new streams.TransformStream<Item, Item>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      if (stopCondition(chunk)) {
        controller.terminate();
      }
    },
  });
