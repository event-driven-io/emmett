import { TransformStream } from '@event-driven-io/emmett-shims';

export const filter = <Item>(filter: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    transform(chunk, controller) {
      if (filter(chunk)) {
        controller.enqueue(chunk);
      }
    },
  });
