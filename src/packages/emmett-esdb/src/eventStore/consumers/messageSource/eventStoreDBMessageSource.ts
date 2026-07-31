import {
  getCheckpoint,
  MessageSourceCaughtUp,
  ProcessorCheckpoint,
  subscriptionMessageSource,
  type AnyMessage,
  type AsyncRetryOptions,
  type Message,
  type MessageSource,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient, ResolvedEvent } from '@eventstore/db-client';
import {
  mapFromESDBEvent,
  type EventStoreDBReadEventMetadata,
} from '../../eventstoreDBEventStore';
import type { EventStoreDBEventStoreConsumerType } from '../eventStoreDBEventStoreConsumer';
import { observeSubscriptionEvents as observeSubscriptionNotifications } from './esdbSubscriptiEvents';
import {
  DefaultEventStoreDBEventStoreProcessorBatchSize,
  EventStoreDBResubscribeDefaultOptions,
  readLastCommittedMessageCheckpoint,
  subscribe,
} from './esdbSubscription';

export type EventStoreDBMessageSourceOptions = {
  client: EventStoreDBClient;
  from?: EventStoreDBEventStoreConsumerType;
  batchSize?: number;
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export const eventStoreDBMessageSource = <
  MessageType extends Message = AnyMessage,
>({
  client,
  from,
  batchSize,
  resilience,
}: EventStoreDBMessageSourceOptions): MessageSource<
  MessageType,
  EventStoreDBReadEventMetadata
> => {
  const resubscribeOptions = resilience?.resubscribeOptions ?? {
    ...EventStoreDBResubscribeDefaultOptions,
    shouldRetryResult: () => true,
  };

  return subscriptionMessageSource<MessageType, EventStoreDBReadEventMetadata>({
    subscribe: async function* ({ from: startFrom, signal }) {
      const subscription = subscribe(client, from, startFrom);
      const notifications = observeSubscriptionNotifications(
        subscription,
        signal,
      );

      let lastCheckpoint: ProcessorCheckpoint | null = null;

      try {
        while (
          !notifications.confirmed &&
          !notifications.ended &&
          !notifications.failure &&
          !signal.aborted
        ) {
          await notifications.waitForNotification();
        }

        while (!signal.aborted) {
          const resolvedEvent =
            subscription.read() as ResolvedEvent<MessageType> | null;

          if (resolvedEvent) {
            if (!resolvedEvent.event) {
              continue;
            }

            const message = mapFromESDBEvent<MessageType>(resolvedEvent, from);

            lastCheckpoint = getCheckpoint(message);
            yield message;
            continue;
          }

          const failure = notifications.failure;

          if (failure) {
            throw failure;
          }

          if (notifications.ended) {
            return;
          }

          if (notifications.takeCaughtUp()) {
            yield MessageSourceCaughtUp(
              lastCheckpoint ?? ProcessorCheckpoint('0'),
            );
            continue;
          }

          await notifications.waitForNotification();
        }
      } finally {
        await notifications.dispose();
      }
    },

    readLastMessageCheckpoint: async (): Promise<ProcessorCheckpoint | null> =>
      (await readLastCommittedMessageCheckpoint(client, from)) ?? null,

    batchSize: batchSize ?? DefaultEventStoreDBEventStoreProcessorBatchSize,
    resilience: resubscribeOptions,
  });
};
