import type {
  EmmettError,
  Event,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  END,
  EventStoreDBClient,
  excludeSystemEvents,
  START,
  type AllStreamJSONRecordedEvent,
  type AllStreamResolvedEvent,
} from '@eventstore/db-client';
import { finished, Readable } from 'stream';
import { mapFromESDBEvent } from '../../eventstoreDBEventStore';

export const DefaultEventStoreDBEventStoreSubscriptionBatchSize = 100;
export const DefaultEventStoreDBEventStoreSubscriptionPullingFrequencyInMs = 50;

export type EventStoreDBEventStoreMessagesBatch<
  EventType extends Event = Event,
> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type EventStoreDBEventStoreMessagesBatchHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export type EventStoreDBEventStoreMessagesBatchHandler<
  EventType extends Event = Event,
> = (
  messagesBatch: EventStoreDBEventStoreMessagesBatch<EventType>,
) =>
  | Promise<EventStoreDBEventStoreMessagesBatchHandlerResult>
  | EventStoreDBEventStoreMessagesBatchHandlerResult;

export type EventStoreDBEventStoreMessageBatchPullerOptions<
  EventType extends Event = Event,
> = {
  eventStoreDBClient: EventStoreDBClient;
  batchSize: number;
  eachBatch: EventStoreDBEventStoreMessagesBatchHandler<EventType>;
};

export type EventStoreDBEventStoreMessageBatchPullerStartFrom =
  | { globalPosition: bigint }
  | 'BEGINNING'
  | 'END';

export type EventStoreDBEventStoreMessageBatchPullerStartOptions = {
  startFrom: EventStoreDBEventStoreMessageBatchPullerStartFrom;
};

export type EventStoreDBEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(
    options: EventStoreDBEventStoreMessageBatchPullerStartOptions,
  ): Promise<void>;
  stop(): Promise<void>;
};

export const eventStoreDBEventStoreMessageBatchPuller = <
  EventType extends Event = Event,
>({
  eventStoreDBClient,
  //batchSize,
  eachBatch,
}: EventStoreDBEventStoreMessageBatchPullerOptions<EventType>): EventStoreDBEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;

  const pullMessages = async (
    options: EventStoreDBEventStoreMessageBatchPullerStartOptions,
  ) => {
    const fromPosition =
      options.startFrom === 'BEGINNING'
        ? START
        : options.startFrom === 'END'
          ? END
          : {
              prepare: options.startFrom.globalPosition,
              commit: options.startFrom.globalPosition,
            };

    const subscription = eventStoreDBClient.subscribeToAll({
      fromPosition,
      filter: excludeSystemEvents(),
    });

    return new Promise<void>((resolve, reject) => {
      finished(
        subscription.on(
          'data',
          async (resolvedEvent: AllStreamResolvedEvent) => {
            if (!resolvedEvent.event) return;

            const event = mapFromESDBEvent(
              resolvedEvent.event as AllStreamJSONRecordedEvent<EventType>,
            );

            const result = await eachBatch({ messages: [event] });

            if (result && result.type === 'STOP') {
              subscription.destroy();
            }
          },
        ) as unknown as Readable,
        (error) => {
          if (!error) {
            console.info(`Stopping subscription.`);
            resolve();
            return;
          }
          console.error(`Received error: ${JSON.stringify(error)}.`);
          reject(error);
        },
      );
    });
    //return subscription;

    // let waitTime = 100;

    // do {
    //   const { messages, currentGlobalPosition, areEventsLeft } =
    //     await readMessagesBatch<EventType>(executor, readMessagesOptions);

    //   if (messages.length > 0) {
    //     const result = await eachBatch({ messages });

    //     if (result && result.type === 'STOP') {
    //       isRunning = false;
    //       break;
    //     }
    //   }

    //   readMessagesOptions.after = currentGlobalPosition;

    //   await new Promise((resolve) => setTimeout(resolve, waitTime));

    //   if (!areEventsLeft) {
    //     waitTime = Math.min(waitTime * 2, 1000);
    //   } else {
    //     waitTime = pullingFrequencyInMs;
    //   }
    // } while (isRunning);
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: (options) => {
      if (isRunning) return start;

      start = (async () => {
        isRunning = true;

        return pullMessages(options);
      })();

      return start;
    },
    stop: async () => {
      if (!isRunning) return;
      isRunning = false;
      await start;
    },
  };
};

export const zipEventStoreDBEventStoreMessageBatchPullerStartFrom = (
  options: (EventStoreDBEventStoreMessageBatchPullerStartFrom | undefined)[],
): EventStoreDBEventStoreMessageBatchPullerStartFrom => {
  if (
    options.length === 0 ||
    options.some((o) => o === undefined || o === 'BEGINNING')
  )
    return 'BEGINNING';

  if (options.every((o) => o === 'END')) return 'END';

  return options
    .filter((o) => o !== undefined && o !== 'BEGINNING' && o !== 'END')
    .sort((a, b) => (a > b ? 1 : -1))[0]!;
};
