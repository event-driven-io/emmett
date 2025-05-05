import {
  asyncRetry,
  type AnyMessage,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type EmmettError,
  type Message,
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
import {
  mapFromESDBEvent,
  type EventStoreDBReadEventMetadata,
} from '../../eventstoreDBEventStore';
import {
  $all,
  type EventStoreDBEventStoreConsumerType,
} from '../eventStoreDBEventStoreConsumer';

export const DefaultEventStoreDBEventStoreProcessorBatchSize = 100;
export const DefaultEventStoreDBEventStoreProcessorPullingFrequencyInMs = 50;

export type EventStoreDBEventStoreMessagesBatchHandlerResult = void | {
  type: 'STOP';
  reason?: string;
  error?: EmmettError;
};

export type EventStoreDBSubscriptionOptions<
  MessageType extends Message = Message,
> = {
  from?: EventStoreDBEventStoreConsumerType;
  client: EventStoreDBClient;
  batchSize: number;
  eachBatch: BatchRecordedMessageHandlerWithoutContext<
    MessageType,
    EventStoreDBReadEventMetadata
  >;
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type EventStoreDBSubscriptionStartFrom =
  | { lastCheckpoint: bigint }
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
          prepare: startFrom.lastCheckpoint,
          commit: startFrom.lastCheckpoint,
        };

const toStreamPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : startFrom.lastCheckpoint;

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

export const eventStoreDBSubscription = <
  MessageType extends AnyMessage = AnyMessage,
>({
  client,
  from,
  //batchSize,
  eachBatch,
  resilience,
}: EventStoreDBSubscriptionOptions<MessageType>): EventStoreDBSubscription => {
  let isRunning = false;

  let start: Promise<void>;

  let subscription: StreamSubscription<MessageType>;

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

              const message = mapFromESDBEvent(
                resolvedEvent.event as JSONRecordedEvent<MessageType>,
              );

              const result = await eachBatch([message]);

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
