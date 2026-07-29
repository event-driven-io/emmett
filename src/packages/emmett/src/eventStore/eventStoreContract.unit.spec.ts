import { describe, it } from 'vitest';
import { assertFalse, assertTrue } from '../testing';
import type {
  AnyMessage,
  Message,
  ReadEventMetadataWithGlobalPosition,
} from '../typing';
import type { MessageConsumer, MessageConsumerOptions } from '../consumers';
import type { EventStore } from './eventStore';
import { getInMemoryEventStore } from './inMemoryEventStore';

type TestConsumerConfig<ConsumerMessageType extends Message = AnyMessage> =
  MessageConsumerOptions<ConsumerMessageType> & {
    pulling?: { batchSize?: number };
  };

type TestConsumer<ConsumerMessageType extends Message = AnyMessage> =
  MessageConsumer<ConsumerMessageType> &
    Readonly<{ reactor: (options: { processorId: string }) => void }>;

/**
 * The point of this file: a store narrowing `consumer()` the way the four
 * store packages do must still satisfy the base interface. If it stops doing
 * so, this stops compiling, which is the contract failing.
 */
interface NarrowingEventStore extends EventStore<ReadEventMetadataWithGlobalPosition> {
  consumer<ConsumerMessageType extends Message = AnyMessage>(
    options?: TestConsumerConfig<ConsumerMessageType>,
  ): TestConsumer<ConsumerMessageType>;
}

void describe('EventStore consumer contract', () => {
  void it('accepts a store that narrows the consumer member', () => {
    const store = {} as NarrowingEventStore;
    const asBaseStore: EventStore<ReadEventMetadataWithGlobalPosition> = store;

    assertTrue(typeof asBaseStore.consumer === 'undefined');
  });

  void it('accepts a store that does not expose a consumer at all', () => {
    const store: EventStore = getInMemoryEventStore();

    assertFalse('consumer' in store);
  });
});
