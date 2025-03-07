import type { EventsPublisher } from '../../messageBus';
import type { DefaultRecord, Event, ReadEvent } from '../../typing';
import type { EventStore, EventStoreReadEventMetadata } from '../eventStore';
import type { AfterEventStoreCommitHandler } from './afterEventStoreCommitHandler';

export const forwardToMessageBus = <
  Store extends EventStore,
  HandlerContext extends DefaultRecord | undefined = undefined,
>(
  eventPublisher: EventsPublisher,
): AfterEventStoreCommitHandler<Store, HandlerContext> =>
  (async (
    messages: ReadEvent<Event, EventStoreReadEventMetadata<Store>>[],
  ): Promise<void> => {
    for (const message of messages) {
      await eventPublisher.publish(message);
    }
  }) as AfterEventStoreCommitHandler<Store, HandlerContext>;
