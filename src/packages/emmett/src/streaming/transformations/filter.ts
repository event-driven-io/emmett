import streams from '@event-driven-io/emmett-shims';

export const filter = <Item>(filter: (item: Item) => boolean) =>
  new streams.TransformStream<Item, Item>({
    transform(chunk, controller) {
      if (filter(chunk)) {
        controller.enqueue(chunk);
      }
    },
  });
