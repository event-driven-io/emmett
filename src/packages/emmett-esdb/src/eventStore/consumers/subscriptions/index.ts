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
  type JSONRecordedEvent,
  type StreamSubscription,
} from '@eventstore/db-client';
import { finished, Readable } from 'stream';
import { mapFromESDBEvent } from '../../eventstoreDBEventStore';
import {
  $all,
  type EventStoreDBEventStoreConsumerType,
} from '../eventStoreDBEventStoreConsumer';

export const DefaultEventStoreDBEventStoreProcessorBatchSize = 100;
export const DefaultEventStoreDBEventStoreProcessorPullingFrequencyInMs = 50;

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

export type EventStoreDBSubscriptionOptions<EventType extends Event = Event> = {
  from?: EventStoreDBEventStoreConsumerType;
  eventStoreDBClient: EventStoreDBClient;
  batchSize: number;
  eachBatch: EventStoreDBEventStoreMessagesBatchHandler<EventType>;
};

export type EventStoreDBSubscriptionStartFrom =
  | { position: bigint }
  | 'BEGINNING'
  | 'END';

export type EventStoreDBSubscriptionStartOptions = {
  startFrom: EventStoreDBSubscriptionStartFrom;
};

export type EventStoreDBEventStoreMessageBatchPuller = {
  isRunning: boolean;
  start(options: EventStoreDBSubscriptionStartOptions): Promise<void>;
  stop(): Promise<void>;
};

const toGlobalPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : {
          prepare: startFrom.position,
          commit: startFrom.position,
        };

const toStreamPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : startFrom.position;

const subscribe = (
  eventStoreDBClient: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
  options: EventStoreDBSubscriptionStartOptions,
) =>
  from == undefined || from.stream == $all
    ? eventStoreDBClient.subscribeToAll({
        fromPosition: toGlobalPosition(options.startFrom),
        filter: excludeSystemEvents(),
        ...(from?.options ?? {}),
      })
    : eventStoreDBClient.subscribeToStream(from.stream, {
        fromRevision: toStreamPosition(options.startFrom),
        ...(from.options ?? {}),
      });

export const eventStoreDBSubscription = <EventType extends Event = Event>({
  eventStoreDBClient,
  from,
  //batchSize,
  eachBatch,
}: EventStoreDBSubscriptionOptions<EventType>): EventStoreDBEventStoreMessageBatchPuller => {
  let isRunning = false;

  let start: Promise<void>;

  let subscription: StreamSubscription<EventType>;

  const pullMessages = async (
    options: EventStoreDBSubscriptionStartOptions,
  ) => {
    subscription = subscribe(eventStoreDBClient, from, options);

    return new Promise<void>((resolve, reject) => {
      finished(
        subscription.on('data', async (resolvedEvent) => {
          if (!resolvedEvent.event) return;

          const event = mapFromESDBEvent(
            resolvedEvent.event as JSONRecordedEvent<EventType>,
          );

          const result = await eachBatch({ messages: [event] });

          if (result && result.type === 'STOP') {
            await subscription.unsubscribe();
          }
        }) as unknown as Readable,
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
      await subscription?.unsubscribe();
      await start;
    },
  };
};

export const zipEventStoreDBEventStoreMessageBatchPullerStartFrom = (
  options: (EventStoreDBSubscriptionStartFrom | undefined)[],
): EventStoreDBSubscriptionStartFrom => {
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
