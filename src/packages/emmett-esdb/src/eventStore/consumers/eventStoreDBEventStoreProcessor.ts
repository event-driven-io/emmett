import {
  EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import { v7 as uuid } from 'uuid';
import type { EventStoreDBSubscriptionStartFrom } from './subscriptions';

export type EventStoreDBEventStoreProcessorEventsBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type EventStoreDBEventStoreProcessor<EventType extends Event = Event> = {
  id: string;
  start: (
    eventStoreDBClient: EventStoreDBClient,
  ) => Promise<EventStoreDBSubscriptionStartFrom | undefined>;
  isActive: boolean;
  handle: (
    messagesBatch: EventStoreDBEventStoreProcessorEventsBatch<EventType>,
    context: { eventStoreDBClient: EventStoreDBClient },
  ) => Promise<EventStoreDBEventStoreProcessorMessageHandlerResult>;
};

export const EventStoreDBEventStoreProcessor = {
  result: {
    skip: (options?: {
      reason?: string;
    }): EventStoreDBEventStoreProcessorMessageHandlerResult => ({
      type: 'SKIP',
      ...(options ?? {}),
    }),
    stop: (options?: {
      reason?: string;
      error?: EmmettError;
    }): EventStoreDBEventStoreProcessorMessageHandlerResult => ({
      type: 'STOP',
      ...(options ?? {}),
    }),
  },
};

export type EventStoreDBEventStoreProcessorMessageHandlerResult =
  | void
  | { type: 'SKIP'; reason?: string }
  | { type: 'STOP'; reason?: string; error?: EmmettError };

export type EventStoreDBEventStoreProcessorEachMessageHandler<
  EventType extends Event = Event,
> = (
  event: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
) =>
  | Promise<EventStoreDBEventStoreProcessorMessageHandlerResult>
  | EventStoreDBEventStoreProcessorMessageHandlerResult;

export type EventStoreDBEventStoreProcessorStartFrom =
  | EventStoreDBSubscriptionStartFrom
  | 'CURRENT';

export type EventStoreDBEventStoreProcessorOptions<
  EventType extends Event = Event,
> = {
  processorId?: string;
  version?: number;
  partition?: string;
  startFrom?: EventStoreDBEventStoreProcessorStartFrom;
  stopAfter?: (
    message: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>,
  ) => boolean;
  eachMessage: EventStoreDBEventStoreProcessorEachMessageHandler<EventType>;
};

export const eventStoreDBEventStoreProcessor = <
  EventType extends Event = Event,
>(
  options: EventStoreDBEventStoreProcessorOptions<EventType>,
): EventStoreDBEventStoreProcessor => {
  const { eachMessage } = options;
  let isActive = true;
  //let lastProcessedPosition: bigint | null = null;

  options.processorId = options.processorId ?? uuid();

  return {
    id: options.processorId,
    start: (
      _eventStoreDBClient: EventStoreDBClient,
    ): Promise<EventStoreDBSubscriptionStartFrom | undefined> => {
      isActive = true;
      if (options.startFrom !== 'CURRENT')
        return Promise.resolve(options.startFrom);

      // const { lastProcessedPosition } = await readProcessorCheckpoint(
      //   execute,
      //   {
      //     processorId: options.processorId,
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
    }): Promise<EventStoreDBEventStoreProcessorMessageHandlerResult> => {
      if (!isActive) return;

      let result:
        | EventStoreDBEventStoreProcessorMessageHandlerResult
        | undefined = undefined;

      //let lastProcessedPosition: bigint | null = null;

      for (const message of messages) {
        const typedMessage = message as ReadEvent<
          EventType,
          ReadEventMetadataWithGlobalPosition
        >;

        const messageProcessingResult = await eachMessage(typedMessage);

        // TODO: Add correct handling of the storing checkpoint
        // await storeProcessorCheckpoint(tx.execute, {
        //   processorId: options.processorId,
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
