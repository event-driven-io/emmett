import type { SQLExecutor } from '@event-driven-io/dumbo';
import type {
  AnySQLiteConnection,
  SQLiteTransaction,
} from '@event-driven-io/dumbo/sqlite';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  MessageHandlerResult,
  MessageProcessingScope,
  MessageProcessor,
  ReadEventMetadataWithGlobalPosition,
  WorkflowHandlerContext,
  WorkflowOptions,
} from '@event-driven-io/emmett';
import {
  defaultProcessorPartition,
  defaultProcessorVersion,
  EmmettError,
  getProcessorInstanceId,
  workflowProcessor,
  type EventStore,
} from '@event-driven-io/emmett';
import type { EventStoreSchemaMigrationOptions } from '../schema';
import { sqliteCheckpointer } from './sqliteCheckpointer';
import type { SQLiteProcessorConnectionOptions } from './sqliteProcessor';

export type SQLiteWorkflowHandlerContext = {
  execute: SQLExecutor;
  connection: AnySQLiteConnection;
  eventStore: EventStore;
} & EventStoreSchemaMigrationOptions;

export type SQLiteWorkflowProcessor<
  MessageType extends AnyMessage = AnyMessage,
> = MessageProcessor<
  MessageType,
  ReadEventMetadataWithGlobalPosition,
  SQLiteWorkflowHandlerContext
>;

export type SQLiteWorkflowProcessorOptions<
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
> = Omit<
  WorkflowOptions<
    Input,
    State,
    Output,
    ReadEventMetadataWithGlobalPosition,
    SQLiteWorkflowHandlerContext
  >,
  'processingScope' | 'checkpoints'
> & {
  eventStore: EventStore;
} & SQLiteProcessorConnectionOptions;

const sqliteWorkflowProcessingScope = (
  eventStore: EventStore,
): MessageProcessingScope<SQLiteWorkflowHandlerContext> => {
  return async <Result = MessageHandlerResult>(
    handler: (
      context: SQLiteWorkflowHandlerContext,
    ) => Result | Promise<Result>,
    partialContext: Partial<SQLiteWorkflowHandlerContext>,
  ) => {
    const connection = partialContext?.connection;

    if (!connection)
      throw new EmmettError('Connection is required in context or options');

    return connection.withTransaction(
      async (transaction: SQLiteTransaction) => {
        return handler({
          ...partialContext,
          connection,
          execute: transaction.execute,
          eventStore,
        });
      },
    );
  };
};

export const sqliteWorkflowProcessor = <
  Input extends AnyEvent | AnyCommand,
  State,
  Output extends AnyEvent | AnyCommand,
>(
  options: SQLiteWorkflowProcessorOptions<Input, State, Output>,
): SQLiteWorkflowProcessor<Input> => {
  const {
    eventStore,
    processorId,
    processorInstanceId = getProcessorInstanceId(processorId),
    version = defaultProcessorVersion,
    partition = defaultProcessorPartition,
    hooks,
    ...rest
  } = options;

  return workflowProcessor({
    ...rest,
    processorId,
    processorInstanceId,
    version,
    partition,
    hooks,
    processingScope: sqliteWorkflowProcessingScope(eventStore),
    checkpoints: sqliteCheckpointer<Input>(),
  });
};
