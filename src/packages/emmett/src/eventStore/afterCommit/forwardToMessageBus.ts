import type { EventsPublisher } from '../../messageBus';
import type { Event, ReadEvent } from '../../typing';
import type { EventStore, EventStoreReadEventMetadata } from '../eventStore';
import type { AfterEventStoreCommitHandler } from './afterEventStoreCommitHandler';

export const forwardToMessageBus =
  <Store extends EventStore, HandlerContext = never>(
    eventPublisher: EventsPublisher,
  ): AfterEventStoreCommitHandler<Store, HandlerContext> =>
  async (
    messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  ): Promise<void> => {
    for (const message of messages) {
      await eventPublisher.publish(message);
    }
  };
