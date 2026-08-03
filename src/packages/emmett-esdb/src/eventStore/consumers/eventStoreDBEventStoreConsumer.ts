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
} from '@event-driven-io/emmett';
import {
  EventStoreDBClient,
  type SubscribeToAllOptions,
  type SubscribeToStreamOptions,
} from '@eventstore/db-client';
import type { EventStoreDBReadEventMetadata } from '../eventstoreDBEventStore';
import { eventStoreDBMessageSource } from './messageSource';

export type EventStoreDBEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  from?: EventStoreDBEventStoreConsumerType;
  pulling?: {
    batchSize?: number;
    batchDeadlineInMs?: number;
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

export type EventStoreDBReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: InMemoryReactorOptions<MessageType>,
) => InMemoryProcessor<MessageType>;

export type EventStoreDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  EventStoreDBReactorFactory<ConsumerMessageType>
> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends ConsumerMessageType & AnyEvent =
            ConsumerMessageType & AnyEvent,
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

  const source = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : eventStoreDBMessageSource<ConsumerMessageType>({
        client,
        from: options.from,
        batchSize: options.pulling?.batchSize,
        resilience: options.resilience,
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

  const messageConsumer = consumer<
    ConsumerMessageType,
    EventStoreDBReadEventMetadata,
    undefined,
    EventStoreDBReactorFactory<ConsumerMessageType>
  >({
    ...options,
    source,
    reactorFactory: inMemoryReactor,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    hooks: {
      onClose: async () => {
        if (isOwnClient) await client.dispose();
      },
    },
  });

  return {
    ...messageConsumer,
    get isRunning() {
      return messageConsumer.isRunning;
    },
    projector: <
      EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
        AnyEvent,
    >(
      processorOptions: InMemoryProjectorOptions<EventType>,
    ): InMemoryProcessor<EventType> =>
      messageConsumer.reactor(
        inMemoryProjector(withMergedObservability(processorOptions)),
      ),
  };
};
