import {
  consumer,
  inMemoryProjector,
  inMemoryReactor,
  mergeObservability,
  type AnyEvent,
  type AnyMessage,
  type AsyncRetryOptions,
  type ConsumerObservabilityConfig,
  type InMemoryProcessor,
  type InMemoryProjectorOptions,
  type InMemoryReactorOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type ProcessorCheckpoint,
  type WaitOptions,
} from '@event-driven-io/emmett';
import {
  EventStoreDBClient,
  type SubscribeToAllOptions,
  type SubscribeToStreamOptions,
} from '@eventstore/db-client';
import type { EventStoreDBReadEventMetadata } from '../eventstoreDBEventStore';
import { eventStoreDBMessageSource } from './eventStoreDBMessageSource';

export type EventStoreDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  from?: EventStoreDBEventStoreConsumerType;
  pulling?: {
    batchSize?: number;
  };
  resilience?: {
    resubscribeOptions?: AsyncRetryOptions;
  };
};

export type EventStoreDBEventStoreConsumerOptions<
  ConsumerEventType extends Message = Message,
> = EventStoreDBEventStoreConsumerConfig<ConsumerEventType> & {
  source?: MessageSource<ConsumerEventType, EventStoreDBReadEventMetadata>;
} & (
    | {
        connectionString: string;
        client?: never;
      }
    | { client: EventStoreDBClient; connectionString?: never }
  );

export type $all = '$all';
export const $all = '$all';

export type EventStoreDBEventStoreConsumerType =
  | {
      stream: $all;
      options?: Exclude<SubscribeToAllOptions, 'fromPosition'>;
    }
  | {
      stream: string;
      options?: Exclude<SubscribeToStreamOptions, 'fromRevision'>;
    };

export type EventStoreDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    whenProcessed: (
      position: ProcessorCheckpoint,
      options?: WaitOptions,
    ) => Promise<void>;
    whenCaughtUp: (options?: WaitOptions) => Promise<void>;

    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      options: InMemoryReactorOptions<MessageType>,
    ) => InMemoryProcessor<MessageType>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends AnyEvent = ConsumerMessageType & AnyEvent,
        >(
          options: InMemoryProjectorOptions<EventType>,
        ) => InMemoryProcessor<EventType>;
      }>
    : object);

export const eventStoreDBEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
>(
  options: EventStoreDBEventStoreConsumerOptions<ConsumerMessageType>,
): EventStoreDBEventStoreConsumer<ConsumerMessageType> => {
  const isOwnClient = !options.client;
  const client =
    options.client ??
    EventStoreDBClient.connectionString(options.connectionString);

  // An injected source is borrowed, so its close is stubbed out: the core
  // consumer closes whatever source it gets, and that's the owner's call.
  const source = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : eventStoreDBMessageSource<ConsumerMessageType>({
        client,
        from: options.from,
        batchSize: options.pulling?.batchSize,
        resilience: options.resilience,
      });

  const messageConsumer = consumer<
    ConsumerMessageType,
    EventStoreDBReadEventMetadata
  >({
    ...options,
    source,
    hooks: {
      onClose: async () => {
        if (isOwnClient) await client.dispose();
      },
    },
  });

  const withMergedObservability = <
    ProcessorOptionsType extends {
      observability?: ConsumerObservabilityConfig;
    },
  >(
    processorOptions: ProcessorOptionsType,
  ): ProcessorOptionsType => ({
    ...processorOptions,
    observability: mergeObservability(
      options.observability,
      processorOptions.observability,
    ),
  });

  return {
    ...messageConsumer,
    get isRunning() {
      return messageConsumer.isRunning;
    },
    reactor: <MessageType extends AnyMessage = ConsumerMessageType>(
      processorOptions: InMemoryReactorOptions<MessageType>,
    ): InMemoryProcessor<MessageType> =>
      messageConsumer.register(
        inMemoryReactor<MessageType>(withMergedObservability(processorOptions)),
      ),
    projector: <EventType extends AnyEvent = ConsumerMessageType & AnyEvent>(
      processorOptions: InMemoryProjectorOptions<EventType>,
    ): InMemoryProcessor<EventType> =>
      messageConsumer.register(
        inMemoryProjector(withMergedObservability(processorOptions)),
      ),
  };
};
