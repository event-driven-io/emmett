import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import { sqliteAmbientConnectionPool } from '@event-driven-io/dumbo/sqlite';
import {
  consumer,
  mergeObservability,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type ConsumerObservabilityConfig,
  type JSONSerializationOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type ReadEventMetadataWithGlobalPosition,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import type {
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from '../eventStoreDriver';
import { getSQLiteEventStore } from '../SQLiteEventStore';
import { sqliteMessageSource } from './messageSource';
import {
  sqliteProjector,
  sqliteReactor,
  sqliteWorkflowProcessor,
  type SQLiteProcessor,
  type SQLiteProcessorHandlerContext,
  type SQLiteProjectorOptions,
  type SQLiteReactorOptions,
  type SQLiteWorkflowProcessorOptions,
} from './sqliteProcessor';

export type SQLiteEventStoreConsumerConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends Message = any,
> = MessageConsumerOptions<ConsumerMessageType> & {
  stopWhen?: {
    noMessagesLeft?: boolean;
  };
  pulling?: {
    batchSize?: number;
    batchDeadlineInMs?: number;
    pullingFrequencyInMs?: number;
  };
};

export type SQLiteEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
> = SQLiteEventStoreConsumerConfig<ConsumerMessageType> & {
  driver: Driver;
  pool?: Dumbo;
  source?: MessageSource<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition
  >;
} & InferOptionsFromEventStoreDriver<Driver> &
  JSONSerializationOptions;

export type SQLiteEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
> = MessageConsumer<ConsumerMessageType> &
  Readonly<{
    reactor: <MessageType extends ConsumerMessageType = ConsumerMessageType>(
      options: SQLiteReactorOptions<MessageType>,
    ) => SQLiteProcessor<MessageType>;

    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends SQLiteProcessorHandlerContext &
        WorkflowProcessorContext = SQLiteProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      options: Omit<
        SQLiteWorkflowProcessorOptions<
          Input,
          State,
          Output,
          MetaDataType,
          HandlerContext,
          StoredMessage
        >,
        'messageStore'
      >,
    ) => SQLiteProcessor<Input | Output>;
  }> &
  (AnyEvent extends ConsumerMessageType
    ? Readonly<{
        projector: <
          EventType extends ConsumerMessageType & AnyEvent =
            ConsumerMessageType & AnyEvent,
        >(
          options: SQLiteProjectorOptions<EventType>,
        ) => SQLiteProcessor<EventType>;
      }>
    : object);

export const sqliteEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
>(
  options: SQLiteEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): SQLiteEventStoreConsumer<ConsumerMessageType> => {
  const isOwnPool = !options.pool;
  const pool =
    options.pool ??
    dumbo({
      serialization: options.serialization,
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
      ...options.driver.mapToDumboOptions(options),
    });

  const source = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : sqliteMessageSource<ConsumerMessageType>({
        pool,
        batchSize: options.pulling?.batchSize,
        pullingFrequencyInMs: options.pulling?.pullingFrequencyInMs,
        serialization: options.serialization,
      });

  const messageConsumer = consumer<
    ConsumerMessageType,
    ReadEventMetadataWithGlobalPosition,
    SQLiteProcessorHandlerContext
  >({
    ...options,
    source,
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) =>
      pool.withConnection((connection) =>
        handler({
          connection,
          execute: connection.execute,
        }),
      ),
    until:
      options.until ??
      (options.stopWhen?.noMessagesLeft === true
        ? { noMessagesLeft: true }
        : undefined),
    hooks: {
      onClose: async () => {
        if (isOwnPool) await pool.close();
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
    reactor: <MessageType extends ConsumerMessageType = ConsumerMessageType>(
      processorOptions: SQLiteReactorOptions<MessageType>,
    ): SQLiteProcessor<MessageType> =>
      messageConsumer.processor(
        sqliteReactor(withMergedObservability(processorOptions)),
      ),
    projector: <
      EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
        AnyEvent,
    >(
      processorOptions: SQLiteProjectorOptions<EventType>,
    ): SQLiteProcessor<EventType> =>
      messageConsumer.processor(
        sqliteProjector(withMergedObservability(processorOptions)),
      ),
    workflowProcessor: <
      Input extends AnyEvent | AnyCommand,
      State,
      Output extends AnyEvent | AnyCommand,
      MetaDataType extends AnyRecordedMessageMetadata =
        AnyRecordedMessageMetadata,
      HandlerContext extends SQLiteProcessorHandlerContext &
        WorkflowProcessorContext = SQLiteProcessorHandlerContext &
        WorkflowProcessorContext,
      StoredMessage extends AnyEvent | AnyCommand = Output,
    >(
      processorOptions: Omit<
        SQLiteWorkflowProcessorOptions<
          Input,
          State,
          Output,
          MetaDataType,
          HandlerContext,
          StoredMessage
        >,
        'messageStore'
      >,
    ): SQLiteProcessor<Input | Output> =>
      messageConsumer.processor(
        sqliteWorkflowProcessor(
          withMergedObservability({
            ...processorOptions,
            messageStore: (connection) =>
              getSQLiteEventStore({
                ...options,
                pool: sqliteAmbientConnectionPool({
                  driverType: options.driver.driverType,
                  connection,
                }),
                schema: { autoMigration: 'None' },
              }),
          }),
        ),
      ),
  };
};
