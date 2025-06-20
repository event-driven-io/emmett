import {
  asyncRetry,
  getCheckpoint,
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
  type ResolvedEvent,
  type StreamSubscription,
} from '@eventstore/db-client';
import { finished, Readable, Writable, type WritableOptions } from 'stream';
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
> = EventStoreDBSubscriptionOptions<MessageType> &
  WritableOptions & {
    onStop: () => Promise<void>;
  };

class SubscriptionSequentialHandler<
  MessageType extends AnyMessage = AnyMessage,
> extends Writable {
  private options: SubscriptionSequentialHandlerOptions<MessageType>;
  public lastCheckpoint: bigint | undefined;
  private from: EventStoreDBEventStoreConsumerType | undefined;

  constructor(options: SubscriptionSequentialHandlerOptions<MessageType>) {
    super({ objectMode: true, ...options });
    this.options = options;
    this.from = options.from;
  }

  async _write(
    resolvedEvent: ResolvedEvent<MessageType>,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): Promise<void> {
    try {
      if (!resolvedEvent.event) return;

      const message = mapFromESDBEvent(resolvedEvent, this.from);
      const messageCheckpoint = getCheckpoint(message);

      const result = await this.options.eachBatch([message]);

      if (result && result.type === 'STOP') {
        await this.options.onStop();

        callback();
        return;
      }

      this.lastCheckpoint = messageCheckpoint!;

      callback();
    } catch (error) {
      callback(error as Error);
    }
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

  let subscription: StreamSubscription<MessageType>;
  let processor: SubscriptionSequentialHandler<MessageType>;

  const resubscribeOptions: AsyncRetryOptions =
    resilience?.resubscribeOptions ?? {
      ...EventStoreDBResubscribeDefaultOptions,
      shouldRetryResult: () => isRunning,
      shouldRetryError: (error) =>
        isRunning &&
        EventStoreDBResubscribeDefaultOptions.shouldRetryError!(error),
    };

  const pipeMessages = (options: EventStoreDBSubscriptionStartOptions) => {
    return asyncRetry(
      () =>
        new Promise<void>((resolve, reject) => {
          subscription = subscribe(client, from, options);

          processor = new SubscriptionSequentialHandler({
            client,
            from,
            batchSize,
            eachBatch,
            resilience,
            onStop: async () => {
              if (processor.lastCheckpoint)
                options.startFrom = {
                  lastCheckpoint: processor.lastCheckpoint,
                };

              isRunning = false;
              await subscription.unsubscribe();
            },
          });

          processor.on('error', (error) => {
            console.error(`Processor error: ${error}`);
            reject(error);
          });

          subscription.pipe(processor);

          finished(subscription as unknown as Readable, (error) => {
            console.info(`Stopping subscription.`);
            if (processor.lastCheckpoint)
              options.startFrom = { lastCheckpoint: processor.lastCheckpoint };

            if (!error) {
              resolve();
              return;
            }

            try {
              subscription
                .unsubscribe()
                .catch((error) => {
                  console.error('Error during unsubscribe.%s', error);
                  // Ignore errors during end
                })
                .finally(() => {
                  console.error(`Received error: ${JSON.stringify(error)}.`);
                  reject(error);
                });
              //processor.end();
            } catch {
              // Ignore errors during end
            }
          });
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
      processor.end();
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
