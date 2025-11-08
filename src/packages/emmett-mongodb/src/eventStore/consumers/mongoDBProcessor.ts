import {
  type AnyEvent,
  type AnyMessage,
  type Checkpointer,
  type Event,
  type Message,
  type MessageHandlerResult,
  type MessageProcessingScope,
  MessageProcessor,
  type ProjectorOptions,
  type ReactorOptions,
  projector,
  reactor,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import type { MongoDBEventStoreConnectionOptions } from '../mongoDBEventStore';
import { mongoDBCheckpointer } from './mongoDBCheckpointer';
import type { MongoDBChangeStreamMessageMetadata } from './mongoDBEventsConsumer';

type MongoDBConnectionOptions = {
  connectionOptions: MongoDBEventStoreConnectionOptions;
};

export type MongoDBProcessorHandlerContext = {
  client: MongoClient;
};

export type MongoDBProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProcessorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  > & { connectionOptions: MongoDBEventStoreConnectionOptions };

export type MongoDBCheckpointer<MessageType extends AnyMessage = AnyMessage> =
  Checkpointer<
    MessageType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  > &
    MongoDBConnectionOptions;

const mongoDBProcessingScope = (options: {
  client: MongoClient;
  processorId: string;
}): MessageProcessingScope<MongoDBProcessorHandlerContext> => {
  const processingScope: MessageProcessingScope<
    MongoDBProcessorHandlerContext
  > = async <Result = MessageHandlerResult>(
    handler: (
      context: MongoDBProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<MongoDBProcessorHandlerContext>,
  ) => {
    return handler({
      client: options.client,
      ...partialContext,
    });
  };

  return processingScope;
};

export const mongoDBProjector = <EventType extends Event = Event>(
  options: MongoDBProjectorOptions<EventType>,
): MongoDBProcessor<EventType> => {
  const { connectionOptions } = options;
  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose
      ? async () => {
          if (options.hooks?.onClose) await options.hooks?.onClose();
        }
      : undefined,
  };
  // TODO: This should be eventually moved to the mongoDBProcessingScope
  // In the similar way as it's made in the postgresql processor
  // So creating client only if it's needed and different than consumer is passing
  // through handler context
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  return projector<
    EventType,
    MongoDBChangeStreamMessageMetadata,
    MongoDBProcessorHandlerContext
  >({
    ...options,
    hooks,
    processingScope: mongoDBProcessingScope({
      client,
      processorId:
        options.processorId ?? `projection:${options.projection.name}`,
    }),

    checkpoints: mongoDBCheckpointer<EventType>(),
  });
};

export const changeStreamReactor = <
  MessageType extends AnyMessage = AnyMessage,
>(
  options: MongoDBProcessorOptions<MessageType>,
): MongoDBProcessor<MessageType> => {
  const connectionOptions = options.connectionOptions || {};
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose
      ? async () => {
          if (options.hooks?.onClose) await options.hooks?.onClose();
        }
      : undefined,
  };

  return reactor({
    ...options,
    hooks,
    processingScope: mongoDBProcessingScope({
      client,
      processorId: options.processorId,
    }),
    checkpoints: mongoDBCheckpointer<MessageType>(),
  });
};
