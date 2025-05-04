import { getInMemoryDatabase, type Database } from '../database';
import { EmmettError } from '../errors';
import {
  type AnyEvent,
  type AnyMessage,
  type BatchRecordedMessageHandlerWithContext,
  type Message,
  type MessageHandlerResult,
  type ReadEventMetadataWithGlobalPosition,
  type SingleRecordedMessageHandlerWithContext,
} from '../typing';
import {
  MessageProcessor,
  projector,
  reactor,
  type Checkpointer,
  type MessageProcessingScope,
  type ProjectorOptions,
  type ReactorOptions,
} from './processors';

export type InMemoryProcessorHandlerContext = {
  database: Database;
};

export type InMemoryProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    // TODO: generalize this to support other metadata types
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext
  > & { database: Database };

export type InMemoryProcessorEachMessageHandler<
  MessageType extends Message = Message,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  InMemoryProcessorHandlerContext
>;

export type InMemoryProcessorEachBatchHandler<
  MessageType extends Message = Message,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  InMemoryProcessorHandlerContext
>;

export type InMemoryProcessorConnectionOptions = {
  database?: Database;
};

type CheckpointDocument = {
  _id: string;
  lastCheckpoint: bigint | null;
};

export type InMemoryCheckpointer<MessageType extends AnyMessage = AnyMessage> =
  Checkpointer<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext
  >;

export const inMemoryCheckpointer = <
  MessageType extends Message = Message,
>(): InMemoryCheckpointer<MessageType> => {
  return {
    read: ({ processorId }, { database }) => {
      const checkpoint = database
        .collection<CheckpointDocument>('emt_processor_checkpoints')
        .findOne((d) => d._id === processorId);

      return Promise.resolve({
        lastCheckpoint: checkpoint?.lastCheckpoint ?? null,
      });
    },
    store: (
      {
        processorId,
        lastCheckpoint,
        message: {
          metadata: { globalPosition: newCheckpoint },
        },
      },
      { database },
    ) => {
      const checkpoints = database.collection<CheckpointDocument>(
        'emt_processor_checkpoints',
      );

      const checkpoint = checkpoints.findOne((d) => d._id === processorId);

      const currentPosition = checkpoint?.lastCheckpoint ?? null;

      if (
        currentPosition === lastCheckpoint ||
        (currentPosition && lastCheckpoint && currentPosition > lastCheckpoint)
      )
        return Promise.resolve({
          success: false,
          reason: currentPosition === lastCheckpoint ? 'IGNORED' : 'MISMATCH',
        });

      checkpoints.replaceOne((d) => d._id === processorId, {
        lastCheckpoint: newCheckpoint,
      });

      return Promise.resolve({ success: true, newCheckpoint });
    },
  };
};

type InMemoryConnectionOptions = {
  connectionOptions?: InMemoryProcessorConnectionOptions;
};

export type InMemoryReactorOptions<MessageType extends Message = Message> =
  ReactorOptions<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext
  > &
    InMemoryConnectionOptions;

export type InMemoryProjectorOptions<EventType extends AnyEvent = AnyEvent> =
  ProjectorOptions<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext
  > &
    InMemoryConnectionOptions;

export type InMemoryProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
> =
  | InMemoryReactorOptions<MessageType>
  | InMemoryProjectorOptions<MessageType & AnyEvent>;

const inMemoryProcessingScope = (options: {
  database: Database | null;
  processorId: string;
}): MessageProcessingScope<InMemoryProcessorHandlerContext> => {
  const processorDatabase = options.database;

  const processingScope: MessageProcessingScope<
    InMemoryProcessorHandlerContext
  > = <Result = MessageHandlerResult>(
    handler: (
      context: InMemoryProcessorHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<InMemoryProcessorHandlerContext>,
  ) => {
    const database = processorDatabase ?? partialContext?.database;

    if (!database)
      throw new EmmettError(
        `InMemory processor '${options.processorId}' is missing database. Ensure that you passed it through options`,
      );

    return handler({ database });
  };

  return processingScope;
};

export const inMemoryProjector = <EventType extends AnyEvent = AnyEvent>(
  options: InMemoryProjectorOptions<EventType>,
): InMemoryProcessor<EventType> => {
  const database = options.connectionOptions?.database ?? getInMemoryDatabase();

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose
      ? async () => {
          if (options.hooks?.onClose) await options.hooks?.onClose();
        }
      : undefined,
  };

  return {
    ...projector<
      EventType,
      ReadEventMetadataWithGlobalPosition,
      InMemoryProcessorHandlerContext
    >({
      ...options,
      hooks,
      processingScope: inMemoryProcessingScope({
        database,
        processorId:
          options.processorId ?? `projection:${options.projection.name}`,
      }),
      checkpoints: inMemoryCheckpointer<EventType>(),
    }),
    database,
  };
};

export const inMemoryReactor = <MessageType extends Message = Message>(
  options: InMemoryReactorOptions<MessageType>,
): InMemoryProcessor<MessageType> => {
  const database = options.connectionOptions?.database ?? getInMemoryDatabase();

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose
      ? async () => {
          if (options.hooks?.onClose) await options.hooks?.onClose();
        }
      : undefined,
  };

  return {
    ...reactor({
      ...options,
      hooks,
      processingScope: inMemoryProcessingScope({
        database,
        processorId: options.processorId,
      }),
      checkpoints: inMemoryCheckpointer<MessageType>(),
    }),
    database,
  };
};
