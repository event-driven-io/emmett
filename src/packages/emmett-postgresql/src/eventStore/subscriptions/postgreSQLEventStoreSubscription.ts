import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';

export type PostgreSQLEventStoreSubscriptionEventsBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type PostgreSQLEventStoreSubscription<EventType extends Event = Event> =
  {
    isActive: boolean;
    handle: (
      messagesBatch: PostgreSQLEventStoreSubscriptionEventsBatch<EventType>,
    ) => Promise<void>;
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
    get isActive() {
      return isActive;
    },
    handle: async ({ messages }) => {
      if (!isActive) return;
      for (const message of messages) {
        const result = await eachMessage(
          message as ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
        );

        if (result) {
          if (result.type === 'SKIP') continue;
          else if (result.type === 'STOP') {
            isActive = false;
            break;
          }
        }
      }
    },
  };
};
