import {
  type AnyEvent,
  type AnyMessage,
  type Checkpointer,
  type Event,
  type GlobalPositionTypeOfRecordedMessageMetadata,
  type Message,
  type MessageHandlerResult,
  type MessageProcessingScope,
  MessageProcessor,
  type ProjectorOptions,
  type ReactorOptions,
  type RecordedMessage,
  projector,
  reactor,
} from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import type {
  ReadEventMetadataWithGlobalPosition,
  StringStreamPosition,
} from '../event';
import type { MongoDBEventStoreConnectionOptions } from '../mongoDBEventStore';
import { readProcessorCheckpoint } from './readProcessorCheckpoint';
import { storeProcessorCheckpoint } from './storeProcessorCheckpoint';
import type { MongoDBResumeToken } from './subscriptions/types';

type MongoDBConnectionOptions = {
  connectionOptions: MongoDBEventStoreConnectionOptions;
};

export type MongoDBProcessorHandlerContext = {
  client: MongoClient;
  // execute: SQLExecutor;
  // connection: {
  //   connectionString: string;
  //   client: NodePostgresClient;
  //   transaction: NodePostgresTransaction;
  //   pool: Dumbo;
  // };
};

export type CommonRecordedMessageMetadata<
  StreamPosition = StringStreamPosition,
> = Readonly<{
  messageId: string;
  streamPosition: StreamPosition;
  streamName: string;
}>;

export type WithGlobalPosition<GlobalPosition> = Readonly<{
  globalPosition: GlobalPosition;
}>;

export type RecordedMessageMetadata<
  GlobalPosition = undefined,
  StreamPosition = StringStreamPosition,
> = CommonRecordedMessageMetadata<StreamPosition> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  (GlobalPosition extends undefined ? {} : WithGlobalPosition<GlobalPosition>);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecordedMessageMetadata = RecordedMessageMetadata<any, any>;

export type MongoDBProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProcessorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    MongoDBProcessorHandlerContext
  > & { connectionOptions: MongoDBEventStoreConnectionOptions };

export type MongoDBCheckpointer<MessageType extends AnyMessage = AnyMessage> =
  Checkpointer<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    MongoDBProcessorHandlerContext
  >;

export type MongoDBProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    MongoDBProcessorHandlerContext
  > &
    MongoDBConnectionOptions;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isResumeToken = (value: any): value is MongoDBResumeToken =>
  '_data' in value &&
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  typeof value._data === 'string';

export const getCheckpoint = <
  MessageType extends AnyMessage = AnyMessage,
  MessageMetadataType extends
    ReadEventMetadataWithGlobalPosition = ReadEventMetadataWithGlobalPosition,
  CheckpointType = GlobalPositionTypeOfRecordedMessageMetadata<MessageMetadataType>,
>(
  message: RecordedMessage<MessageType, MessageMetadataType>,
): CheckpointType | null => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return 'checkpoint' in message.metadata &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    isResumeToken(message.metadata.checkpoint)
    ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      message.metadata.checkpoint
    : 'globalPosition' in message.metadata &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        isResumeToken(message.metadata.globalPosition)
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        message.metadata.globalPosition
      : 'streamPosition' in message.metadata &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          isResumeToken(message.metadata.streamPosition)
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          message.metadata.streamPosition
        : null;
};

export const mongoDBCheckpointer = <
  MessageType extends Message = Message,
>(): MongoDBCheckpointer<MessageType> => ({
  read: async (options, context) => {
    const result = await readProcessorCheckpoint(context.client, options);

    return { lastCheckpoint: result?.lastProcessedPosition };
  },
  store: async (options, context) => {
    const newPosition: MongoDBResumeToken | null = getCheckpoint(
      options.message,
    );

    const result = await storeProcessorCheckpoint(context.client, {
      lastProcessedPosition: options.lastCheckpoint,
      newPosition,
      processorId: options.processorId,
      partition: options.partition,
      version: options.version,
    });

    return result.success
      ? { success: true, newCheckpoint: result.newPosition }
      : result;
  },
});

const mongoDBProcessingScope = (options: {
  client: MongoClient;
  processorId: string;
}): MessageProcessingScope<MongoDBProcessorHandlerContext> => {
  // const processorConnectionString = options.connectionString;

  const processingScope: MessageProcessingScope<
    MongoDBProcessorHandlerContext
  > = async <Result = MessageHandlerResult>(
    handler: (
      context: MongoDBProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<MongoDBProcessorHandlerContext>,
  ) => {
    // const connection = partialContext?.connection;
    // const connectionString =
    //   processorConnectionString ?? connection?.connectionString;

    // if (!connectionString)
    //   throw new EmmettError(
    //     `MongoDB processor '${options.processorId}' is missing connection string. Ensure that you passed it through options`,
    //   );

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
  const client =
    'client' in connectionOptions && connectionOptions.client
      ? connectionOptions.client
      : new MongoClient(
          connectionOptions.connectionString,
          connectionOptions.clientOptions,
        );

  return projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
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
