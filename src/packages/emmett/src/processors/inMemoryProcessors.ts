import { getInMemoryDatabase, type InMemoryDatabase } from '../database';
import { EmmettError } from '../errors';
import {
  type AnyEvent,
  type AnyMessage,
  type BatchRecordedMessageHandlerWithContext,
  type MessageHandlerResult,
  type ReadEventMetadataWithGlobalPosition,
  type SingleRecordedMessageHandlerWithContext,
} from '../typing';
import {
  getCheckpoint,
  MessageProcessor,
  projector,
  reactor,
  type Checkpointer,
  type MessageProcessingScope,
  type ProjectorOptions,
  type ReactorOptions,
} from './processors';

export type InMemoryProcessorHandlerContext = {
  database: InMemoryDatabase;
};

export type InMemoryProcessor<MessageType extends AnyMessage = AnyMessage> =
  MessageProcessor<
    MessageType,
    // TODO: generalize this to support other metadata types
    ReadEventMetadataWithGlobalPosition,
    InMemoryProcessorHandlerContext
  > & { database: InMemoryDatabase };

export type InMemoryProcessorEachMessageHandler<
  MessageType extends AnyMessage = AnyMessage,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  InMemoryProcessorHandlerContext
>;

export type InMemoryProcessorEachBatchHandler<
  MessageType extends AnyMessage = AnyMessage,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  InMemoryProcessorHandlerContext
>;

export type InMemoryProcessorConnectionOptions = {
  database?: InMemoryDatabase;
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
  MessageType extends AnyMessage = AnyMessage,
>(): InMemoryCheckpointer<MessageType> => {
  return {
    read: async ({ processorId }, { database }) => {
      const checkpoint = await database
        .collection<CheckpointDocument>('emt_processor_checkpoints')
        .findOne((d) => d._id === processorId);

      return Promise.resolve({
        lastCheckpoint: checkpoint?.lastCheckpoint ?? null,
      });
    },
    store: async (context, { database }) => {
      const { message, processorId, lastCheckpoint } = context;
      const checkpoints = database.collection<CheckpointDocument>(
        'emt_processor_checkpoints',
      );

      const checkpoint = await checkpoints.findOne(
        (d) => d._id === processorId,
      );

      const currentPosition = checkpoint?.lastCheckpoint ?? null;

      const newCheckpoint: bigint | null = getCheckpoint(message);

      if (
        currentPosition &&
        (currentPosition === newCheckpoint ||
          currentPosition !== lastCheckpoint)
      ) {
        return {
          success: false,
          reason: currentPosition === newCheckpoint ? 'IGNORED' : 'MISMATCH',
        };
      }

      await checkpoints.handle(processorId, (existing) => ({
        ...(existing ?? {}),
        _id: processorId,
        lastCheckpoint: newCheckpoint,
      }));

      return { success: true, newCheckpoint };
    },
  };
};

type InMemoryConnectionOptions = {
  connectionOptions?: InMemoryProcessorConnectionOptions;
};

export type InMemoryReactorOptions<
  MessageType extends AnyMessage = AnyMessage,
> = ReactorOptions<
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
  database: InMemoryDatabase | null;
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

    return handler({ ...partialContext, database });
  };

  return processingScope;
};

export const inMemoryProjector = <EventType extends AnyEvent = AnyEvent>(
  options: InMemoryProjectorOptions<EventType>,
): InMemoryProcessor<EventType> => {
  const database = options.connectionOptions?.database ?? getInMemoryDatabase();

  const hooks = {
    onInit: options.hooks?.onInit,
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose
      ? async (context: InMemoryProcessorHandlerContext) => {
          if (options.hooks?.onClose) await options.hooks?.onClose(context);
        }
      : undefined,
  };

  const processor = projector<
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
  });

  return Object.assign(processor, { database });
};

export const inMemoryReactor = <MessageType extends AnyMessage = AnyMessage>(
  options: InMemoryReactorOptions<MessageType>,
): InMemoryProcessor<MessageType> => {
  const database = options.connectionOptions?.database ?? getInMemoryDatabase();

  const hooks = {
    onStart: options.hooks?.onStart,
    onClose: options.hooks?.onClose,
  };

  const processor = reactor({
    ...options,
    hooks,
    processingScope: inMemoryProcessingScope({
      database,
      processorId: options.processorId,
    }),
    checkpoints: inMemoryCheckpointer<MessageType>(),
  });

  return Object.assign(processor, { database });
};
