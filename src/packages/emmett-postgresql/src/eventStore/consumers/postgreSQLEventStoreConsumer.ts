import {
  dumbo,
  schemaComponentMigrator,
  type AnySchemaComponent,
  type MigrationStyle,
} from '@event-driven-io/dumbo';
import {
  consumer,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type AnyRecordedMessageMetadata,
  type ConsumerHooks,
  type JSONSerializationOptions,
  type Message,
  type MessageConsumer,
  type MessageConsumerOptions,
  type MessageSource,
  type RecordedMessageMetadataWithGlobalPosition,
  type PartialHandlerContext,
  type WorkflowProcessorContext,
} from '@event-driven-io/emmett';
import {
  pgEventStoreDriver,
  type PgEventStoreDriver,
  type PgEventStoreDriverOptions,
} from '../../pg';
import type {
  AnyPostgreSQLEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  InferPoolFromEventStoreDriver,
  PoolOrConnectionOptions,
} from '../eventStoreDriver';
import {
  isPostgreSQLProjectionWithSchema,
  postgreSQLProjectionWithDatabaseSchemaName,
  postgreSQLSchemaOf,
  type PostgreSQLProjectionSchema,
} from '../projections';
import {
  eventStoreDatabaseSchema,
  eventStoreSchemaComponent,
  type EventStoreDatabaseSchemaOptions,
  type EventStoreSchemaMigrationOptions,
} from '../schema';
import { postgreSQLMessageSource } from './messageSource';
import {
  postgreSQLProjector,
  postgreSQLReactor,
  postgreSQLWorkflowProcessor,
  type PostgreSQLProcessor,
  type PostgreSQLProcessorHandlerContext,
  type PostgreSQLProjectorOptions,
  type PostgreSQLReactorOptions,
  type PostgreSQLWorkflowProcessorOptions,
} from './postgreSQLProcessor';

export type PostgreSQLEventStoreConsumerConfig<
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
  schema?: {
    autoMigration?: MigrationStyle | undefined;
  } & EventStoreDatabaseSchemaOptions;
} & JSONSerializationOptions;

export type PostgreSQLEventStoreConsumerConnectionOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = {
  source?: MessageSource<
    NoInfer<ConsumerMessageType>,
    RecordedMessageMetadataWithGlobalPosition
  >;
  hooks?: Pick<ConsumerHooks, 'onInit'>;
} & {
  /**
   * @deprecated pass `driver` instead; this form is removed in the next major.
   */
  connectionString?: string;
  driver?: Driver;
} & PoolOrConnectionOptions<Driver>;

export type PostgreSQLEventStoreConsumerOptions<
  ConsumerMessageType extends Message = Message,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = PostgreSQLEventStoreConsumerConfig<ConsumerMessageType> &
  PostgreSQLEventStoreConsumerConnectionOptions<ConsumerMessageType, Driver>;

export type PostgreSQLReactorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = <MessageType extends ConsumerMessageType = ConsumerMessageType>(
  options: PostgreSQLReactorOptions<MessageType, MessageType, Driver>,
) => PostgreSQLProcessor<MessageType, Driver>;

export type PostgreSQLProjectorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = <
  EventType extends ConsumerMessageType & AnyEvent = ConsumerMessageType &
    AnyEvent,
>(
  options: PostgreSQLProjectorOptions<EventType, EventType, Driver>,
) => PostgreSQLProcessor<EventType, Driver>;

export type PostgreSQLWorkflowProcessorFactory<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = <
  Input extends ConsumerMessageType,
  State,
  Output extends ConsumerMessageType,
  MetaDataType extends AnyRecordedMessageMetadata = AnyRecordedMessageMetadata,
  HandlerContext extends PostgreSQLProcessorHandlerContext<Driver> &
    WorkflowProcessorContext = PostgreSQLProcessorHandlerContext<Driver> &
    WorkflowProcessorContext,
  StoredMessage extends AnyEvent | AnyCommand = Output,
>(
  options: Omit<
    PostgreSQLWorkflowProcessorOptions<
      Input,
      State,
      Output,
      MetaDataType,
      HandlerContext,
      StoredMessage,
      Driver
    >,
    'messageStore'
  >,
) => PostgreSQLProcessor<Input | Output, Driver>;

export type PostgreSQLEventStoreConsumer<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ConsumerMessageType extends AnyMessage = any,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
> = MessageConsumer<
  ConsumerMessageType,
  PostgreSQLReactorFactory<ConsumerMessageType, Driver>,
  PostgreSQLProjectorFactory<ConsumerMessageType, Driver>,
  PostgreSQLWorkflowProcessorFactory<ConsumerMessageType, Driver>
>;

export const postgreSQLEventStoreConsumer = <
  ConsumerMessageType extends Message = AnyMessage,
  Driver extends AnyPostgreSQLEventStoreDriver = PgEventStoreDriver,
>(
  options: PostgreSQLEventStoreConsumerOptions<ConsumerMessageType, Driver>,
): PostgreSQLEventStoreConsumer<ConsumerMessageType, Driver> => {
  const databaseSchema = eventStoreDatabaseSchema(options.schema);
  const processorMetadataSchema = {
    ...options.schema,
    ...databaseSchema,
  };
  const autoMigration = options.schema?.autoMigration ?? 'CreateOrUpdate';
  const processorSchemaComponents: AnySchemaComponent[] = [];
  let schemaMigrator: ReturnType<typeof schemaComponentMigrator> | undefined;

  const migrationOptionsFor = (
    migrationOptions: NonNullable<
      EventStoreSchemaMigrationOptions['migrationOptions']
    >,
    schema: PostgreSQLProjectionSchema | undefined,
  ): NonNullable<EventStoreSchemaMigrationOptions['migrationOptions']> => {
    const processorAutoMigration =
      migrationOptions.autoMigration ?? autoMigration;
    if (!schema || processorAutoMigration !== autoMigration)
      return { ...migrationOptions, autoMigration: processorAutoMigration };

    processorSchemaComponents.push(schema.component);
    return { ...migrationOptions, autoMigration: 'None' };
  };
  const isOwnPool = !options.pool;
  const connectionOptions = {
    serialization: options.serialization,
    ...(options.driver ?? pgEventStoreDriver).mapToDumboOptions(
      options as PgEventStoreDriverOptions,
    ),
  } as InferDumboOptionsFromEventStoreDriver<Driver>;

  // TODO: Fix this cast when introducing more drivers
  const pool = (options.pool ??
    dumbo(connectionOptions)) as InferPoolFromEventStoreDriver<Driver>;

  const source: MessageSource<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition
  > = options.source
    ? { ...options.source, close: () => Promise.resolve() }
    : postgreSQLMessageSource<ConsumerMessageType>({
        pool,
        batchSize: options.pulling?.batchSize,
        pullingFrequencyInMs: options.pulling?.pullingFrequencyInMs,
        databaseSchemaName: databaseSchema.databaseSchemaName,
      });

  const processorContext: PartialHandlerContext<
    PostgreSQLProcessorHandlerContext<Driver>
  > = {
    execute: pool.execute,
    migrationOptions: processorMetadataSchema,
    session: { pool, connectionOptions },
  };

  const messageConsumer = consumer<
    ConsumerMessageType,
    RecordedMessageMetadataWithGlobalPosition,
    PostgreSQLProcessorHandlerContext<Driver>,
    PostgreSQLReactorFactory<ConsumerMessageType, Driver>,
    PostgreSQLProjectorFactory<ConsumerMessageType, Driver>,
    PostgreSQLWorkflowProcessorFactory<ConsumerMessageType, Driver>
  >({
    ...options,
    source,
    reactorFactory: (processorOptions) => {
      const migrationOptions =
        processorOptions.migrationOptions ?? processorMetadataSchema;

      return postgreSQLReactor({
        ...processorOptions,
        driver: options.driver,
        migrationOptions: migrationOptionsFor(
          migrationOptions,
          postgreSQLSchemaOf(
            processorOptions,
            eventStoreDatabaseSchema(migrationOptions).databaseSchemaName,
          ),
        ),
      });
    },
    projectorFactory: (processorOptions) => {
      const migrationOptions =
        processorOptions.migrationOptions ?? processorMetadataSchema;
      const projection = postgreSQLProjectionWithDatabaseSchemaName(
        processorOptions.projection,
        eventStoreDatabaseSchema(migrationOptions)
          .projectionsDatabaseSchemaName,
      );

      return postgreSQLProjector({
        ...processorOptions,
        driver: options.driver,
        migrationOptions: migrationOptionsFor(
          migrationOptions,
          isPostgreSQLProjectionWithSchema(projection)
            ? projection.schema
            : undefined,
        ),
      });
    },
    workflowProcessorFactory: (processorOptions) => {
      const migrationOptions =
        processorOptions.migrationOptions ?? processorMetadataSchema;

      return postgreSQLWorkflowProcessor({
        ...processorOptions,
        driver: options.driver,
        migrationOptions: migrationOptionsFor(
          migrationOptions,
          postgreSQLSchemaOf(
            processorOptions,
            eventStoreDatabaseSchema(migrationOptions).databaseSchemaName,
          ),
        ),
      });
    },
    batchSize: options.pulling?.batchSize,
    batchDeadlineInMs: options.pulling?.batchDeadlineInMs,
    scope: (handler) => handler(processorContext),
    until:
      options.until ??
      (options.stopWhen?.noMessagesLeft === true
        ? { noMessagesLeft: true }
        : undefined),
    hooks: {
      onInit: async () => {
        if (options.hooks?.onInit) await options.hooks.onInit();

        if (autoMigration === 'None') return;

        schemaMigrator ??= schemaComponentMigrator({
          pool,
          component: eventStoreSchemaComponent(
            options.schema,
            processorSchemaComponents,
          ),
          migrationTable: databaseSchema.migrationTable,
        });

        if (autoMigration === 'EnsureMigrated')
          await schemaMigrator.ensureMigrated();
        else await schemaMigrator.migrate();
      },
      onClose: async () => {
        if (isOwnPool) await pool.close();
      },
    },
  });

  return messageConsumer;
};
