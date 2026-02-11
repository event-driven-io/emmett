import type { SQLExecutor } from '@event-driven-io/dumbo';
import type {
  AnySQLiteConnection,
  SQLiteTransaction,
} from '@event-driven-io/dumbo/sqlite';
import type {
  AnyEvent,
  AnyMessage,
  BatchRecordedMessageHandlerWithContext,
  Message,
  MessageHandlerResult,
  MessageProcessingScope,
  MessageProcessor,
  ProcessorHooks,
  ProjectorOptions,
  ReactorOptions,
  ReadEventMetadataWithGlobalPosition,
  SingleRecordedMessageHandlerWithContext,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  EmmettError,
  getProcessorInstanceId,
  getProjectorId,
  projector,
  reactor,
  type Event,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import type { SQLiteEventStoreMessageBatchPullerStartFrom } from './messageBatchProcessing';
import { sqliteCheckpointer } from './sqliteCheckpointer';

export type SQLiteProcessorEventsBatch<EventType extends Event = Event> = {
  messages: ReadEvent<EventType, ReadEventMetadataWithGlobalPosition>[];
};

export type SQLiteProcessorHandlerContext = {
  execute: SQLExecutor;
  connection: AnySQLiteConnection;
} &
  // TODO: Reconsider if it should be for all processors
  EventStoreSchemaMigrationOptions;

export type SQLiteProcessor<MessageType extends Message = AnyMessage> =
  MessageProcessor<
    MessageType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext
  >;

export type SQLiteProcessorEachMessageHandler<
  MessageType extends Message = Message,
> = SingleRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext
>;

export type SQLiteProcessorEachBatchHandler<
  MessageType extends Message = Message,
> = BatchRecordedMessageHandlerWithContext<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext
>;

export type SQLiteProcessorStartFrom =
  | SQLiteEventStoreMessageBatchPullerStartFrom
  | 'CURRENT';

export type SQLiteProcessorConnectionOptions = {
  connection?: AnySQLiteConnection;
};

export type SQLiteReactorOptions<
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
> = ReactorOptions<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext,
  MessagePayloadType
> &
  SQLiteProcessorConnectionOptions;

export type SQLiteProjectorOptions<
  EventType extends AnyEvent = AnyEvent,
  EventPayloadType extends Event = EventType,
> = ProjectorOptions<
  EventType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteProcessorHandlerContext,
  EventPayloadType
> &
  SQLiteProcessorConnectionOptions &
  EventStoreSchemaMigrationOptions;

export type SQLiteProcessorOptions<
  MessageType extends AnyMessage = AnyMessage,
  MessagePayloadType extends AnyMessage = MessageType,
> =
  | SQLiteReactorOptions<MessageType, MessagePayloadType>
  | SQLiteProjectorOptions<
      MessageType & AnyEvent,
      MessagePayloadType & AnyEvent
    >;

const sqliteProcessingScope =
  (): MessageProcessingScope<SQLiteProcessorHandlerContext> => {
    const processingScope: MessageProcessingScope<
      SQLiteProcessorHandlerContext
    > = async <Result = MessageHandlerResult>(
      handler: (
        context: SQLiteProcessorHandlerContext,
      ) => Result | Promise<Result>,
      partialContext: Partial<SQLiteProcessorHandlerContext>,
    ) => {
      const connection = partialContext?.connection;

      if (!connection)
        // TODO: Map it to dumbo connection correctly
        throw new EmmettError('Connection is required in context or options');

      return connection.withTransaction(
        async (transaction: SQLiteTransaction) => {
          return handler({
            ...partialContext,
            connection: connection,
            execute: transaction.execute,
          });
        },
      );
    };

    return processingScope;
  };

export const sqliteReactor = <
  MessageType extends Message = Message,
  MessagePayloadType extends AnyMessage = MessageType,
>(
  options: SQLiteReactorOptions<MessageType, MessagePayloadType>,
): SQLiteProcessor<MessageType> => {
  const {
    processorId = options.processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    hooks,
  } = options;

  return reactor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteProcessingScope(),

    checkpoints: sqliteCheckpointer<MessageType>(),
  });
};

export const sqliteProjector = <
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
>(
  options: SQLiteProjectorOptions<EventType, EventPayloadType>,
): SQLiteProcessor<EventType> => {
  const {
    processorId = getProjectorId({
      projectionName: options.projection.name ?? 'unknown',
    }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  const hooks: ProcessorHooks<SQLiteProcessorHandlerContext> = {
    ...(options.hooks ?? {}),
    onInit:
      options.projection.init !== undefined || options.hooks?.onInit
        ? async (context: SQLiteProcessorHandlerContext) => {
            if (options.projection.init)
              await options.projection.init({
                version: options.projection.version ?? version,
                status: 'active',
                registrationType: 'async',
                context: {
                  ...context,
                  migrationOptions: options.migrationOptions,
                },
              });
            if (options.hooks?.onInit)
              await options.hooks.onInit({
                ...context,
                migrationOptions: options.migrationOptions,
              });
          }
        : options.hooks?.onInit,
    onClose: options.hooks?.onClose,
  };

  const processor = projector<
    EventType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext,
    EventPayloadType
  >({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteProcessingScope(),
    checkpoints: sqliteCheckpointer<EventType>(),
  });

  return processor;
};
