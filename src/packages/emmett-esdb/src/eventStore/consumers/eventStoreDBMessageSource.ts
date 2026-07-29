import {
  getCheckpoint,
  globalStreamCaughtUp,
  subscriptionMessageSource,
  type AnyMessage,
  type AsyncRetryOptions,
  type Message,
  type MessageSource,
  type MessageSourceMessage,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient, ResolvedEvent } from '@eventstore/db-client';
import {
  mapFromESDBEvent,
  type EventStoreDBReadEventMetadata,
} from '../eventstoreDBEventStore';
import type { EventStoreDBEventStoreConsumerType } from './eventStoreDBEventStoreConsumer';
import {
  DefaultEventStoreDBEventStoreProcessorBatchSize,
  EventStoreDBResubscribeDefaultOptions,
  subscribe,
  readLastCommittedMessageCheckpoint,
} from './subscriptions';

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
    subscribe: async function* ({
      from: startFrom,
      batchSize: requestedBatchSize,
      signal,
    }) {
      const subscription = subscribe(client, from, startFrom);

      let lastCheckpoint: ProcessorCheckpoint | null = null;
      let confirmed = false;
      let caughtUpPending = false;
      let ended = false;
      let failure: Error | undefined;
      let notificationPending = false;
      let notificationWaiter: (() => void) | null = null;

      const notify = () => {
        if (notificationWaiter) {
          const resolve = notificationWaiter;
          notificationWaiter = null;
          resolve();
          return;
        }

        notificationPending = true;
      };
      const waitForNotification = (): Promise<void> => {
        if (notificationPending) {
          notificationPending = false;
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          notificationWaiter = resolve;
        });
      };
      const onConfirmation = () => {
        confirmed = true;
        notify();
      };
      const onCaughtUp = () => {
        caughtUpPending = true;
        notify();
      };
      const onFellBehind = () => {
        caughtUpPending = false;
        notify();
      };
      const onReadable = () => notify();
      const onEnd = () => {
        ended = true;
        notify();
      };
      const onError = (error: Error) => {
        failure = error;
        notify();
      };
      const onAbort = () => notify();

      subscription.on('confirmation', onConfirmation);
      subscription.on('caughtUp', onCaughtUp);
      subscription.on('fellBehind', onFellBehind);
      subscription.on('readable', onReadable);
      subscription.on('end', onEnd);
      subscription.on('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });

      try {
        while (!confirmed && !ended && !failure && !signal.aborted)
          await waitForNotification();

        let readinessEmitted = false;

        while (!signal.aborted) {
          const messages: MessageSourceMessage<
            MessageType,
            EventStoreDBReadEventMetadata
          >[] = [];

          // Draining what the subscription has already buffered is what makes
          // the batch size real: iterating it would block on every message.
          while (messages.length < requestedBatchSize) {
            const resolvedEvent =
              subscription.read() as ResolvedEvent<MessageType> | null;
            if (!resolvedEvent) break;
            if (!resolvedEvent.event) continue;

            const message = mapFromESDBEvent<MessageType>(resolvedEvent, from);
            lastCheckpoint = getCheckpoint(message);
            messages.push(message);
          }

          if (messages.length > 0) {
            readinessEmitted = true;
            yield { messages, lastCheckpoint };
            continue;
          }

          if (failure) throw failure;
          if (ended) return;

          if (caughtUpPending) {
            caughtUpPending = false;
            readinessEmitted = true;
            yield {
              messages: [
                globalStreamCaughtUp({
                  globalPosition: lastCheckpoint ?? '0',
                }),
              ],
              lastCheckpoint,
            };
            continue;
          }

          if (!readinessEmitted) {
            readinessEmitted = true;
            yield { messages: [], lastCheckpoint };
            continue;
          }

          await waitForNotification();
        }
      } finally {
        signal.removeEventListener('abort', onAbort);
        await subscription.unsubscribe().catch(() => {});
        subscription.destroy();
        subscription.off('confirmation', onConfirmation);
        subscription.off('caughtUp', onCaughtUp);
        subscription.off('fellBehind', onFellBehind);
        subscription.off('readable', onReadable);
        subscription.off('end', onEnd);
        subscription.off('error', onError);
      }
    },
    readLastCheckpoint: async (): Promise<ProcessorCheckpoint | null> =>
      (await readLastCommittedMessageCheckpoint(client, from)) ?? null,
    batchSize: batchSize ?? DefaultEventStoreDBEventStoreProcessorBatchSize,
    resilience: resubscribeOptions,
  });
};
