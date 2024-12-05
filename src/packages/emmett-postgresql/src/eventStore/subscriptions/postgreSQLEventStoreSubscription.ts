import { type Dumbo, type SQLExecutor } from '@event-driven-io/dumbo';
import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  readSubscriptionCheckpoint,
  storeSubscriptionCheckpoint,
} from '../schema';
import type { PostgreSQLEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';

export type PostgreSQLEventStoreSubscriptionEventsBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type PostgreSQLEventStoreSubscription<EventType extends Event = Event> =
  {
    id: string;
    start: (
      execute: SQLExecutor,
    ) => Promise<PostgreSQLEventStoreMessageBatchPullerStartFrom | undefined>;
    isActive: boolean;
    handle: (
      messagesBatch: PostgreSQLEventStoreSubscriptionEventsBatch<EventType>,
      context: { pool: Dumbo },
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

export type PostgreSQLEventStoreSubscriptionStartFrom =
  | PostgreSQLEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

export type PostgreSQLEventStoreSubscriptionOptions<
  EventType extends Event = Event,
> = {
  subscriptionId: string;
  version?: number;
  partition?: string;
  startFrom?: PostgreSQLEventStoreSubscriptionStartFrom;
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
  //let lastProcessedPosition: bigint | null = null;

  return {
    id: options.subscriptionId,
    start: async (
      execute: SQLExecutor,
    ): Promise<PostgreSQLEventStoreMessageBatchPullerStartFrom | undefined> => {
      isActive = true;
      if (options.startFrom !== 'CURRENT') return options.startFrom;

      const { lastProcessedPosition } = await readSubscriptionCheckpoint(
        execute,
        {
          subscriptionId: options.subscriptionId,
          partition: options.partition,
        },
      );

      if (lastProcessedPosition === null) return 'BEGINNING';

      return { globalPosition: lastProcessedPosition };
    },
    get isActive() {
      return isActive;
    },
    handle: async (
      { messages },
      { pool },
    ): Promise<PostgreSQLEventStoreSubscriptionMessageHandlerResult> => {
      if (!isActive) return;

      return pool.withTransaction(async (tx) => {
        let result:
          | PostgreSQLEventStoreSubscriptionMessageHandlerResult
          | undefined = undefined;

        let lastProcessedPosition: bigint | null = null;

        for (const message of messages) {
          const typedMessage = message as ReadEvent<
            EventType,
            ReadEventMetadataWithGlobalPosition
          >;

          const messageProcessingResult = await eachMessage(typedMessage);

          // TODO: Add correct handling of the storing checkpoint
          await storeSubscriptionCheckpoint(tx.execute, {
            subscriptionId: options.subscriptionId,
            version: options.version,
            lastProcessedPosition,
            newPosition: typedMessage.metadata.globalPosition,
            partition: options.partition,
          });

          lastProcessedPosition = typedMessage.metadata.globalPosition;

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

          if (
            messageProcessingResult &&
            messageProcessingResult.type === 'SKIP'
          )
            continue;
        }

        return result;
      });
    },
  };
};
