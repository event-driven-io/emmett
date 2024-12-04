import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLEventStoreSubscriptionEventsBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type PostgreSQLEventStoreSubscription<EventType extends Event = Event> =
  {
    startFrom?: PostgreSQLEventStoreMessageBatchPullerStartFrom;
    isActive: boolean;
    handle: (
      messagesBatch: PostgreSQLEventStoreSubscriptionEventsBatch<EventType>,
    ) => Promise<PostgreSQLEventStoreSubscriptionMessageHandlerResult>;
  };

export const PostgreSQLEventStoreSubscription = {
  result: {
    skip: (options?: {
      reason?: string;
    }): PostgreSQLEventStoreSubscriptionMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): PostgreSQLEventStoreSubscriptionMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type PostgreSQLEventStoreSubscriptionMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type PostgreSQLEventStoreSubscriptionEachMessageHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
) =>
  | Promise<PostgreSQLEventStoreSubscriptionMessageHandlerResult>
  | PostgreSQLEventStoreSubscriptionMessageHandlerResult;

export const DefaultPostgreSQLEventStoreSubscriptionBatchSize = 100;

export type PostgreSQLEventStoreSubscriptionOptions<
  EventType extends Event = Event,
> = {
  startFrom?: PostgreSQLEventStoreMessageBatchPullerStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  eachMessage: PostgreSQLEventStoreSubscriptionEachMessageHandler<EventType>;
};

export const postgreSQLEventStoreSubscription = <
  EventType extends Event = Event,
>(
  options: PostgreSQLEventStoreSubscriptionOptions<EventType>,
): PostgreSQLEventStoreSubscription => {
  const { eachMessage } = options;
  let isActive = true;

  return {
    startFrom: options.startFrom,
    get isActive() {
      return isActive;
    },
    handle: async ({
      messages,
    }): Promise<PostgreSQLEventStoreSubscriptionMessageHandlerResult> => {
      if (!isActive) return;
      for (const message of messages) {
        const typedMessage = message as ReadEvent<
          EventType,
          ReadEventMetadataWithGlobalPosition
        >;

        const result = await eachMessage(typedMessage);

        if (options.stopAfter && options.stopAfter(typedMessage)) {
          isActive = false;
          return { type: 'STOP', reason: 'Stop condition reached' };
        }

        if (result) {
          if (result.type === 'SKIP') continue;
          else if (result.type === 'STOP') {
            isActive = false;
            return result;
          }
        }
      }
    },
  };
};
