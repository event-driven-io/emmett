import type { SQLExecutor } from '@event-driven-io/dumbo';
import type {
  AnySQLiteConnection,
  SQLiteTransaction,
} from '@event-driven-io/dumbo/sqlite';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  AnyRecordedMessageMetadata,
  BatchRecordedMessageHandlerWithContext,
  Checkpointer,
  Message,
  MessageHandlerResult,
  MessageProcessingScope,
  MessageProcessor,
  ProcessorHooks,
  ProjectorOptions,
  ReactorOptions,
  ReadEventMetadataWithGlobalPosition,
  SingleRecordedMessageHandlerWithContext,
  WorkflowProcessorContext,
  WorkflowProcessorOptions,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  EmmettError,
  getProcessorInstanceId,
  getProjectorId,
  getWorkflowId,
  projector,
  reactor,
  workflowProcessor,
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

export type SQLiteWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends WorkflowProcessorContext = WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
> = WorkflowProcessorOptions<
  Input,
  State,
  Output,
  MetaDataType,
  HandlerContext,
  StoredMessage
> &
  SQLiteProcessorConnectionOptions & {
    messageStore: WorkflowProcessorContext['connection']['messageStore'];
  };

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

const sqliteWorkflowProcessingScope = (
  messageStore: WorkflowProcessorContext['connection']['messageStore'],
): MessageProcessingScope<
  SQLiteProcessorHandlerContext & WorkflowProcessorContext
> => {
  const processingScope: MessageProcessingScope<
    SQLiteProcessorHandlerContext & WorkflowProcessorContext
  > = async <Result = MessageHandlerResult>(
    handler: (
      context: SQLiteProcessorHandlerContext & WorkflowProcessorContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<
      SQLiteProcessorHandlerContext & WorkflowProcessorContext
    >,
  ) => {
    const connection = partialContext?.connection;

    if (!connection)
      throw new EmmettError('Connection is required in context or options');

    return connection.withTransaction(
      async (transaction: SQLiteTransaction) => {
        return handler({
          ...partialContext,
          connection: Object.assign(connection, { messageStore }),
          execute: transaction.execute,
        });
      },
    );
  };

  return processingScope;
};

export const sqliteWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends SQLiteProcessorHandlerContext &
    WorkflowProcessorContext = SQLiteProcessorHandlerContext &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: SQLiteWorkflowProcessorOptions<
    Input,
    State,
    Output,
    MetaDataType,
    HandlerContext,
    StoredMessage
  >,
): SQLiteProcessor<Input | Output> => {
  const {
    processorId = options.processorId ??
      getWorkflowId({
        workflowName: options.workflow.name ?? 'unknown',
      }),
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
  } = options;

  const hooks: ProcessorHooks<HandlerContext> = {
    ...(options.hooks ?? {}),
    onClose: options.hooks?.onClose,
  };

  return workflowProcessor({
    ...options,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteWorkflowProcessingScope(
      options.messageStore,
    ) as unknown as MessageProcessingScope<HandlerContext>,
    checkpoints: sqliteCheckpointer<Input | Output>() as Checkpointer<
      Input | Output,
      MetaDataType,
      HandlerContext
    >,
  }) as SQLiteProcessor<Input | Output>;
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
