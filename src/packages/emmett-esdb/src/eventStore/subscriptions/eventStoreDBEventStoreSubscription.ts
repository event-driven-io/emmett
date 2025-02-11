import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import type { EventStoreDBEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type EventStoreDBEventStoreSubscriptionEventsBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type EventStoreDBEventStoreSubscription<
  EventType extends Event = Event,
> = {
  id: string;
  start: (
    eventStoreDBClient: EventStoreDBClient,
  ) => Promise<EventStoreDBEventStoreMessageBatchPullerStartFrom | undefined>;
  isActive: boolean;
  handle: (
    messagesBatch: EventStoreDBEventStoreSubscriptionEventsBatch<EventType>,
    context: { eventStoreDBClient: EventStoreDBClient },
  ) => Promise<EventStoreDBEventStoreSubscriptionMessageHandlerResult>;
};

export const EventStoreDBEventStoreSubscription = {
  result: {
    skip: (options?: {
      reason?: string;
    }): EventStoreDBEventStoreSubscriptionMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): EventStoreDBEventStoreSubscriptionMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type EventStoreDBEventStoreSubscriptionMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type EventStoreDBEventStoreSubscriptionEachMessageHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
) =>
  | Promise<EventStoreDBEventStoreSubscriptionMessageHandlerResult>
  | EventStoreDBEventStoreSubscriptionMessageHandlerResult;

export type EventStoreDBEventStoreSubscriptionStartFrom =
  | EventStoreDBEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

export type EventStoreDBEventStoreSubscriptionOptions<
  EventType extends Event = Event,
> = {
  subscriptionId: string;
  version?: number;
  partition?: string;
  startFrom?: EventStoreDBEventStoreSubscriptionStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  eachMessage: EventStoreDBEventStoreSubscriptionEachMessageHandler<EventType>;
};

export const eventStoreDBEventStoreSubscription = <
  EventType extends Event = Event,
>(
  options: EventStoreDBEventStoreSubscriptionOptions<EventType>,
): EventStoreDBEventStoreSubscription => {
  const { eachMessage } = options;
  let isActive = true;
  //let lastProcessedPosition: bigint | null = null;

  return {
    id: options.subscriptionId,
    start: (
      _eventStoreDBClient: EventStoreDBClient,
    ): Promise<
      EventStoreDBEventStoreMessageBatchPullerStartFrom | undefined
    > => {
      isActive = true;
      if (options.startFrom !== 'CURRENT')
        return Promise.resolve(options.startFrom);

      // const { lastProcessedPosition } = await readSubscriptionCheckpoint(
      //   execute,
      //   {
      //     subscriptionId: options.subscriptionId,
      //     partition: options.partition,
      //   },
      // );

      // if (lastProcessedPosition === null) return 'BEGINNING';

      // return { globalPosition: lastProcessedPosition };
      return Promise.resolve('BEGINNING');
    },
    get isActive() {
      return isActive;
    },
    handle: async ({
      messages,
    }): Promise<EventStoreDBEventStoreSubscriptionMessageHandlerResult> => {
      if (!isActive) return;

      let result:
        | EventStoreDBEventStoreSubscriptionMessageHandlerResult
        | undefined = undefined;

      //let lastProcessedPosition: bigint | null = null;

      for (const message of messages) {
        const typedMessage = message as ReadEvent<
          EventType,
          ReadEventMetadataWithGlobalPosition
        >;

        const messageProcessingResult = await eachMessage(typedMessage);

        // TODO: Add correct handling of the storing checkpoint
        // await storeSubscriptionCheckpoint(tx.execute, {
        //   subscriptionId: options.subscriptionId,
        //   version: options.version,
        //   lastProcessedPosition,
        //   newPosition: typedMessage.metadata.globalPosition,
        //   partition: options.partition,
        // });

        //lastProcessedPosition = typedMessage.metadata.globalPosition;

        if (
          messageProcessingResult &&
          messageProcessingResult.type === 'STOP'
        ) {
          isActive = false;
          result = messageProcessingResult;
          break;
        }

        if (options.stopAfter && options.stopAfter(typedMessage)) {
          isActive = false;
          result = { type: 'STOP', reason: 'Stop condition reached' };
          break;
        }

        if (messageProcessingResult && messageProcessingResult.type === 'SKIP')
          continue;
      }

      return result;
    },
  };
};
