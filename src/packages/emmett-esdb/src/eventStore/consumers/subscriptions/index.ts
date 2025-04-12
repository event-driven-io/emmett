import {
  asyncRetry,
  type AsyncRetryOptions,
  type EmmettError,
  type Event,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
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
  client: EventStoreDBClient;
  batchSize: number;
  eachBatch: EventStoreDBEventStoreMessagesBatchHandler<EventType>;
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type EventStoreDBSubscriptionStartFrom =
  | { position: bigint }
  | 'BEGINNING'
  | 'END';

export type EventStoreDBSubscriptionStartOptions = {
  startFrom: EventStoreDBSubscriptionStartFrom;
};

export type EventStoreDBSubscription = {
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
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
  options: EventStoreDBSubscriptionStartOptions,
) =>
  from == undefined || from.stream == $all
    ? client.subscribeToAll({
        fromPosition: toGlobalPosition(options.startFrom),
        filter: excludeSystemEvents(),
        ...(from?.options ?? {}),
      })
    : client.subscribeToStream(from.stream, {
        fromRevision: toStreamPosition(options.startFrom),
        ...(from.options ?? {}),
      });

export const isDatabaseUnavailableError = (error: unknown) =>
  error instanceof Error &&
  'type' in error &&
  error.type === 'unavailable' &&
  'code' in error &&
  error.code === 14;

export const EventStoreDBResubscribeDefaultOptions: AsyncRetryOptions = {
  forever: true,
  minTimeout: 100,
  factor: 1.5,
  shouldRetryError: (error) => !isDatabaseUnavailableError(error),
};

export const eventStoreDBSubscription = <EventType extends Event = Event>({
  client,
  from,
  //batchSize,
  eachBatch,
  resilience,
}: EventStoreDBSubscriptionOptions<EventType>): EventStoreDBSubscription => {
  let isRunning = false;

  let start: Promise<void>;

  let subscription: StreamSubscription<EventType>;

  const resubscribeOptions: AsyncRetryOptions =
    resilience?.resubscribeOptions ?? {
      ...EventStoreDBResubscribeDefaultOptions,
      shouldRetryResult: () => isRunning,
      shouldRetryError: (error) =>
        isRunning &&
        EventStoreDBResubscribeDefaultOptions.shouldRetryError!(error),
    };

  const pipeMessages = (options: EventStoreDBSubscriptionStartOptions) => {
    subscription = subscribe(client, from, options);

    return asyncRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          finished(
            subscription.on('data', async (resolvedEvent) => {
              if (!resolvedEvent.event) return;

              const event = mapFromESDBEvent(
                resolvedEvent.event as JSONRecordedEvent<EventType>,
              );

              const result = await eachBatch({ messages: [event] });

              if (result && result.type === 'STOP') {
                isRunning = false;
                await subscription.unsubscribe();
              }

              from = {
                stream: from?.stream ?? $all,
                options: {
                  ...(from?.options ?? {}),
                  ...(!from || from?.stream === $all
                    ? {
                        fromPosition: resolvedEvent.event.position,
                      }
                    : { fromRevision: resolvedEvent.event.revision }),
                },
              };
            }) as unknown as Readable,
            (error) => {
              if (error) {
                console.error(`Received error: ${JSON.stringify(error)}.`);
                reject(error);
                return;
              }
              console.info(`Stopping subscription.`);
              resolve();
            },
          );
        }),
      resubscribeOptions,
    );
  };

  return {
    get isRunning() {
      return isRunning;
    },
    start: (options) => {
      if (isRunning) return start;

      start = (async () => {
        isRunning = true;

        return pipeMessages(options);
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
