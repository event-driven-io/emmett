import {
  asyncRetry,
  getCheckpoint,
  isString,
  JSONParser,
  parseBigIntProcessorCheckpoint,
  type AnyMessage,
  type AsyncRetryOptions,
  type BatchRecordedMessageHandlerWithoutContext,
  type EmmettError,
  type Message,
  type MessageHandlerResult,
  type ProcessorCheckpoint,
} from '@event-driven-io/emmett';
import type { EventStoreDBClient } from '@eventstore/db-client';
import {
  SequentialTransform,
  type SequentialTransformHandler,
  type SequentialTransformHandlerResult,
} from '@event-driven-io/emmett/nodejs';
import {
  END,
  excludeSystemEvents,
  START,
  type ResolvedEvent,
  type StreamSubscription,
} from '@eventstore/db-client';
import { pipeline, Writable, type WritableOptions } from 'stream';
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
  | { lastCheckpoint: ProcessorCheckpoint }
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
          prepare: parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint),
          commit: parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint),
        };

const toStreamPosition = (startFrom: EventStoreDBSubscriptionStartFrom) =>
  startFrom === 'BEGINNING'
    ? START
    : startFrom === 'END'
      ? END
      : parseBigIntProcessorCheckpoint(startFrom.lastCheckpoint);

const subscribe = (
  client: EventStoreDBClient,
  from: EventStoreDBEventStoreConsumerType | undefined,
  options: EventStoreDBSubscriptionStartOptions,
) =>
  from == undefined || from.stream == $all
    ? client.subscribeToAll({
        ...(from?.options ?? {}),
        fromPosition: toGlobalPosition(options.startFrom),
        filter: excludeSystemEvents(),
      })
    : client.subscribeToStream(from.stream, {
        ...(from.options ?? {}),
        fromRevision: toStreamPosition(options.startFrom),
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

type SubscriptionSequentialHandlerOptions<
  MessageType extends AnyMessage = AnyMessage,
> = EventStoreDBSubscriptionOptions<MessageType> & WritableOptions;

class SubscriptionSequentialHandler<
  MessageType extends AnyMessage = AnyMessage,
> extends SequentialTransform<ResolvedEvent<MessageType>, bigint | null> {
  private options: SubscriptionSequentialHandlerOptions<MessageType>;
  private from: EventStoreDBEventStoreConsumerType | undefined;
  public isRunning: boolean;

  constructor(options: SubscriptionSequentialHandlerOptions<MessageType>) {
    const handler: SequentialTransformHandler<
      ResolvedEvent<MessageType>,
      bigint
    > = async (
      resolvedEvent: ResolvedEvent<MessageType>,
    ): Promise<SequentialTransformHandlerResult<bigint>> => {
      if (!this.isRunning || !resolvedEvent.event) {
        return { resultType: 'SKIP' };
      }

      const message = mapFromESDBEvent(resolvedEvent, this.from);
      const messageCheckpoint = getCheckpoint(message)!;

      const result = await this.options.eachBatch([message]);

      if (result && result.type === 'STOP') {
        this.isRunning = false;
        if (!result.error) {
          return { resultType: 'ACK', message: messageCheckpoint };
        }

        return { resultType: 'STOP', ...result };
      }

      return { resultType: 'ACK', message: messageCheckpoint };
    };
    super({
      ...options,
      handler,
    });
    this.options = options;
    this.from = options.from;
    this.isRunning = true;
  }
}

export const eventStoreDBSubscription = <
  MessageType extends AnyMessage = AnyMessage,
>({
  client,
  from,
  batchSize,
  eachBatch,
  resilience,
}: EventStoreDBSubscriptionOptions<MessageType>): EventStoreDBSubscription => {
  let isRunning = false;

  let start: Promise<void>;
  let processor: SubscriptionSequentialHandler<MessageType>;

  let subscription: StreamSubscription<MessageType>;

  const resubscribeOptions: AsyncRetryOptions =
    resilience?.resubscribeOptions ?? {
      ...EventStoreDBResubscribeDefaultOptions,
      shouldRetryResult: () => isRunning,
      shouldRetryError: (error) =>
        isRunning &&
        EventStoreDBResubscribeDefaultOptions.shouldRetryError!(error),
    };

  const stopSubscription = (callback?: () => void): Promise<void> => {
    isRunning = false;
    if (processor) processor.isRunning = false;
    return subscription
      .unsubscribe()
      .then(() => {
        subscription.destroy();
      })
      .catch((err) => console.error('Error during unsubscribe.%s', err))
      .finally(callback ?? (() => {}));
  };

  const pipeMessages = (options: EventStoreDBSubscriptionStartOptions) => {
    let retry = 0;
    return asyncRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          if (!isRunning) {
            resolve();
            return;
          }
          console.info(
            `Starting subscription. ${retry++} retries. From: ${JSONParser.stringify(from ?? '$all')}, Start from: ${JSONParser.stringify(
              options.startFrom,
            )}`,
          );
          subscription = subscribe(client, from, options);

          processor = new SubscriptionSequentialHandler({
            client,
            from,
            batchSize,
            eachBatch,
            resilience,
          });

          const handler = new (class extends Writable {
            async _write(
              result: ProcessorCheckpoint | MessageHandlerResult,
              _encoding: string,
              done: () => void,
            ) {
              if (!isRunning) return;

              if (isString(result)) {
                options.startFrom = {
                  lastCheckpoint: result,
                };
                done();
                return;
              }

              if (result && result.type === 'STOP' && result.error) {
                console.error(
                  `Subscription stopped with error code: ${result.error.errorCode}, message: ${
                    result.error.message
                  }.`,
                );
              }

              await stopSubscription();
              done();
            }
          })({ objectMode: true });

          pipeline(
            subscription,
            processor,
            handler,
            async (error: Error | null) => {
              console.info(`Stopping subscription.`);
              await stopSubscription(() => {
                if (!error) {
                  console.info('Subscription ended successfully.');
                  resolve();
                  return;
                }
                console.error(
                  `Received error: ${JSONParser.stringify(error)}.`,
                );
                reject(error);
              });
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
      if (!isRunning) return start ? await start : Promise.resolve();
      await stopSubscription();
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
