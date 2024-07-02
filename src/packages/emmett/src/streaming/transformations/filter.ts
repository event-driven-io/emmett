import { TransformStream } from 'web-streams-polyfill';

export const filter = <Item>(filter: (item: Item) => boolean) =>
  new TransformStream<Item, Item>({
    transform(chunk, controller) {
      if (filter(chunk)) {
        controller.enqueue(chunk);
      }
    },
  });
