import {
  consumer,
  type AnyCommand,
  inMemoryProjector,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type AsyncRetryOptions,
  type InMemoryProcessor,
  type InMemoryProjectorOptions,
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
import {
  eventStoreDBReactor,
  eventStoreDBWorkflowProcessor,
  type EventStoreDBProcessor,
  type EventStoreDBWorkflowProcessorHandlerContext,
  type EventStoreDBReactorOptions,
  type EventStoreDBWorkflowProcessorOptions,
} from './eventStoreDBProcessor';
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

type WithoutClient<Options> = Options extends unknown
  ? Omit<Options, 'client'>
  : never;

export type EventStoreDBReactorFactoryOptions<
  MessageType extends AnyMessage = AnyMessage,
> = WithoutClient<EventStoreDBReactorOptions<MessageType>>;

export type EventStoreDBReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: EventStoreDBReactorFactoryOptions<MessageType>,
) => EventStoreDBProcessor<MessageType>;

export type EventStoreDBProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: InMemoryProjectorOptions<EventType>,
) => InMemoryProcessor<EventType>;

export type EventStoreDBEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<
  ConsumerMessageType,
  EventStoreDBReactorFactory<ConsumerMessageType>,
  EventStoreDBProjectorFactory<ConsumerMessageType>,
  EventStoreDBWorkflowProcessorFactory<ConsumerMessageType>
>;

export type EventStoreDBWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends EventStoreDBWorkflowProcessorHandlerContext =
    EventStoreDBWorkflowProcessorHandlerContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: Omit<
    EventStoreDBWorkflowProcessorOptions<
      Input,
      State,
      Output,
      MetaDataType,
      HandlerContext,
      StoredMessage
    >,
    'client'
  >,
) => EventStoreDBProcessor<Input | Output>;

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

  const workflowProcessorFactory: EventStoreDBWorkflowProcessorFactory<
    ConsumerMessageType
  > = (workflowOptions) =>
    eventStoreDBWorkflowProcessor({
      ...workflowOptions,
      client,
    });

  const reactorFactory: EventStoreDBReactorFactory<ConsumerMessageType> = (
    reactorOptions,
  ) =>
    eventStoreDBReactor({
      ...reactorOptions,
      client,
    });

  const messageConsumer = consumer<
    ConsumerMessageType,
    EventStoreDBReadEventMetadata,
    undefined,
    EventStoreDBReactorFactory<ConsumerMessageType>,
    EventStoreDBProjectorFactory<ConsumerMessageType>,
    EventStoreDBWorkflowProcessorFactory<ConsumerMessageType>
  >({
    ...options,
    source,
    reactorFactory,
    projectorFactory: inMemoryProjector,
    workflowProcessorFactory,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    hooks: {
      onClose: async () => {
        if (isOwnClient) await client.dispose();
      },
    },
  });

  return messageConsumer;
};
