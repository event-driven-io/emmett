import {
  dumbo,
  InvalidOperationError,
  isSchemaComponent,
  type AnyConnection,
  type AnyDatabaseTransaction,
  type AnySchemaComponent,
  type DatabaseTransactionOptions,
  type Dumbo,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  assertExpectedVersionMatchesCurrent,
  bigIntProcessorCheckpoint,
  eventStoreCollector,
  eventStoreObservability,
  ExpectedVersionConflictError,
  JSONSerializer,
  mergeObservability,
  NO_CONCURRENCY_CHECK,
  noopScope,
  withOperationScope,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AnyMessage,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type AutoMigration,
  type BeforeEventStoreCommitHandler,
  type EmmettObservabilityConfig,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type JSONSerializationOptions,
  type Message,
  type ProjectionHandlingType,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type StreamExistsResult,
} from '@event-driven-io/emmett';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
  type SQLiteEventStoreConsumerConfig,
} from './consumers';
import type {
  AnySQLiteEventStoreDriver,
  InferDumboOptionsFromEventStoreDriver,
  PoolOrConnectionOptions,
} from './eventStoreDriver';
import {
  connectionToSQLiteProjectionInitContext,
  handleProjections,
  transactionToSQLiteProjectionHandlerContext,
  type SQLiteProjectionDefinition,
  type SQLiteProjectionHandlerContext,
  type SQLiteProjectionInitContext,
} from './projections';
import {
  appendToStream,
  eventStoreDatabaseSchema,
  eventStoreSchemaComponent,
  readStream,
  streamExists,
  unknownTag,
  type CreateEventStoreSchemaOptions,
  type EventStoreDatabaseSchemaOptions,
  type SQLiteStreamExistsOptions,
} from './schema';
import { truncateTables } from './schema/truncateTables';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const SQLiteEventStoreDefaultStreamVersion = 0n;

export interface SQLiteEventStore
  extends
    EventStore<SQLiteReadEventMetadata>,
    EventStoreSessionFactory<SQLiteEventStore> {
  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<EventType, EventPayloadType>,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerMessageType extends Message = AnyMessage>(
    options?: SQLiteEventStoreConsumerConfig<ConsumerMessageType>,
  ): SQLiteEventStoreConsumer<ConsumerMessageType>;
  streamExists(
    streamName: string,
    options?: SQLiteStreamExistsOptions,
  ): Promise<StreamExistsResult>;
  close(): Promise<void>;
  init(): Promise<void>;
  schema: {
    readonly component: AnySchemaComponent;
    sql(): string;
    print(): void;
    migrate(
      options?: CreateEventStoreSchemaOptions,
    ): Promise<RunSQLMigrationsResult>;
    ensureMigrated(): Promise<void>;
    dangerous: {
      truncate(options?: { truncateProjections?: boolean }): Promise<void>;
    };
  };
}

export type SQLiteReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type SQLiteReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  SQLiteReadEventMetadata
>;

export type SQLiteEventStoreOptions<
  EventStoreDriver extends AnySQLiteEventStoreDriver =
    AnySQLiteEventStoreDriver,
> = {
  driver: EventStoreDriver;
  projections?: ProjectionRegistration<
    ProjectionHandlingType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext<EventStoreDriver>,
    unknown,
    SQLiteProjectionInitContext<EventStoreDriver>
  >[];
  observability?: EmmettObservabilityConfig;
  schema?: {
    autoMigration?: AutoMigration;
    ignoreMigrationHashMismatch?: boolean;
  } & EventStoreDatabaseSchemaOptions;
  hooks?: {
    /**
     * This hook will be called **BEFORE** event store schema is created
     */
    onBeforeSchemaCreated?: (
      context: SQLiteProjectionHandlerContext<EventStoreDriver>,
    ) => Promise<void> | void;
    /**
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<SQLiteEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      {
        connection: AnySQLiteConnection;
        transaction: AnyDatabaseTransaction;
      }
    >;
    /**
     * This hook will be called **AFTER** event store schema was created
     */
    onAfterSchemaCreated?: (
      context: SQLiteProjectionHandlerContext<EventStoreDriver>,
    ) => Promise<void> | void;
  };
} & PoolOrConnectionOptions<EventStoreDriver> &
  JSONSerializationOptions;

type SQLiteEventStoreSession<
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
> = {
  pool: Dumbo;
  driver: Driver;
  connectionOptions: InferDumboOptionsFromEventStoreDriver<Driver>;
};

const withProjectionsSchemaName = <Projection>(
  projection: Projection,
  projectionsDatabaseSchemaName: string | undefined,
): Projection =>
  projectionsDatabaseSchemaName === undefined
    ? projection
    : (((
        projection as Pick<SQLiteProjectionDefinition, 'withDefaultSchemaName'>
      ).withDefaultSchemaName?.(projectionsDatabaseSchemaName) as
        Projection | undefined) ?? projection);

export const getSQLiteEventStore = <
  Driver extends AnySQLiteEventStoreDriver = AnySQLiteEventStoreDriver,
>(
  options: SQLiteEventStoreOptions<Driver>,
): SQLiteEventStore => {
  const autoMigration = options.schema?.autoMigration ?? 'CreateOrUpdate';
  const serializer = JSONSerializer.from(options);
  const databaseSchema = eventStoreDatabaseSchema(options.schema);

  const dumboOptions = {
    serialization: options.serialization,
    ...options.driver.mapToDumboOptions(options),
  } as InferDumboOptionsFromEventStoreDriver<Driver>;

  const pool: Dumbo = options.pool ?? dumbo(dumboOptions);

  const session: SQLiteEventStoreSession<Driver> = {
    pool,
    driver: options.driver,
    connectionOptions: dumboOptions,
  };

  const projectionRegistrations = (options.projections ?? []).map(
    ({ type, projection }) => ({
      type,
      projection: withProjectionsSchemaName(
        projection,
        databaseSchema.projectionsDatabaseSchemaName,
      ),
    }),
  );
  const inlineProjections = projectionRegistrations
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);
  const eventStoreSchema = eventStoreSchemaComponent({
    pool,
    schema: options.schema,
    migrationOptions: {
      ...options.driver.migrationOptions?.(pool),
      ignoreMigrationHashMismatch: options.schema?.ignoreMigrationHashMismatch,
    },
  });
  for (const { projection } of projectionRegistrations) {
    if (isSchemaComponent(projection.schema))
      eventStoreSchema.add(projection.schema);
  }
  const observability = eventStoreObservability(options);
  const collector = eventStoreCollector(observability);

  const onBeforeCommitHook = options.hooks?.onBeforeCommit;

  let schemaMigrated = false;

  const migrate = async (
    migrationOptions?: CreateEventStoreSchemaOptions,
  ): Promise<RunSQLMigrationsResult> => {
    const dryRun = migrationOptions?.dryRun ?? false;

    if (schemaMigrated && !dryRun)
      return { applied: [], skipped: [...eventStoreSchema.migrations] };

    if (dryRun === 'diff')
      return eventStoreSchema.migrator.migrate({
        dryRun,
        ignoreMigrationHashMismatch:
          migrationOptions?.ignoreMigrationHashMismatch,
        migrationTimeoutMS: migrationOptions?.migrationTimeoutMs,
      });

    if (
      dryRun === 'transactional' &&
      !options.driver.dumboDriver.databaseMetadata.capabilities
        .supportsTransactions
    )
      throw new InvalidOperationError(
        `${pool.driverType} does not support transactions, so it cannot run a transactional dry run. Use dryRun: 'diff' instead.`,
      );

    const migrationSchemaOptions = {
      ...options.schema,
      ...migrationOptions,
      ...databaseSchema,
    };

    const result = await pool.withTransaction(async (transaction) => {
      const context: SQLiteProjectionHandlerContext<Driver> = {
        ...transactionToSQLiteProjectionHandlerContext(session, transaction),
        migrationOptions: migrationSchemaOptions,
      };

      if (options.hooks?.onBeforeSchemaCreated) {
        await options.hooks.onBeforeSchemaCreated(context);
      }

      const result = await eventStoreSchema.migrator.migrate({
        execute: transaction.execute,
        ignoreMigrationHashMismatch:
          migrationOptions?.ignoreMigrationHashMismatch,
        migrationTimeoutMS: migrationOptions?.migrationTimeoutMs,
      });

      if (options.hooks?.onAfterSchemaCreated) {
        await options.hooks.onAfterSchemaCreated(context);
      }

      return { success: dryRun !== 'transactional', result };
    });

    if (!dryRun) schemaMigrated = true;

    return result;
  };

  const ensureMigrated = () => eventStoreSchema.migrator.ensureMigrated();

  const initializeInlineProjections = () =>
    pool.withConnection(async (connection) => {
      const context = connectionToSQLiteProjectionInitContext(
        session,
        connection,
      );

      for (const projection of inlineProjections) {
        if (projection.init) {
          await projection.init({
            version: projection.version ?? 1,
            status: 'active',
            registrationType: 'inline',
            context: {
              ...context,
              migrationOptions: { ...options.schema, ...databaseSchema },
              observabilityScope: noopScope,
            },
          });
        }
      }
    });

  let initialized = false;

  const init = async () => {
    if (initialized) return;

    if (!schemaMigrated) {
      if (autoMigration === 'CreateOrUpdate') await migrate();
      else if (autoMigration === 'EnsureMigrated') await ensureMigrated();
    }

    if (inlineProjections.some(({ init }) => init !== undefined))
      await initializeInlineProjections();

    initialized = true;
  };

  const readStreamFromSQLite = <
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    pool: Dumbo,
    streamName: string,
    readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
  ): Promise<
    ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
  > =>
    collector.instrumentRead(
      streamName,
      async () => {
        await init();

        return readStream<EventType, EventPayloadType>(
          pool.execute,
          streamName,
          {
            ...readOptions,
            databaseSchemaName: databaseSchema.databaseSchemaName,
            serializer: options.serialization?.serializer ?? serializer,
          },
        );
      },
      readOptions?.observability,
    );

  const sessionFor = (
    connection: AnyConnection,
  ): SQLiteEventStoreSession<Driver> => {
    const { transactionOptions } = dumboOptions as {
      transactionOptions?: DatabaseTransactionOptions;
    };

    return {
      pool: dumbo({
        driver: options.driver.dumboDriver,
        serialization: options.serialization,
        transactionOptions,
        connection,
      }),
      driver: options.driver,
      connectionOptions: dumboOptions,
    };
  };

  const storeFor = (
    session: SQLiteEventStoreSession<Driver>,
  ): SQLiteEventStore => ({
    init,
    async aggregateStream<
      State,
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition,
        EventPayloadType
      >,
    ): Promise<AggregateStreamResult<State>> {
      return collector.instrumentAggregate(
        streamName,
        async (scope) => {
          const { evolve, initialState, read } = options;

          const expectedStreamVersion = read?.expectedStreamVersion;

          let state = initialState();

          if (typeof streamName !== 'string') {
            throw new Error('Stream name is not string');
          }

          const result = await readStreamFromSQLite<
            EventType,
            EventPayloadType
          >(session.pool, streamName, {
            ...(read ?? {}),
            observability: withOperationScope(scope, read?.observability),
          });

          const currentStreamVersion = result.currentStreamVersion;

          assertExpectedVersionMatchesCurrent(
            currentStreamVersion,
            expectedStreamVersion,
            SQLiteEventStoreDefaultStreamVersion,
          );

          for (const event of result.events) {
            if (!event) continue;
            state = evolve(state, event);
          }

          return {
            currentStreamVersion: currentStreamVersion,
            state,
            streamExists: result.streamExists,
          };
        },
        options.observability,
      );
    },

    readStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > => readStreamFromSQLite(session.pool, streamName, readOptions),

    appendToStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      appendOptions?: AppendToStreamOptions<EventType, EventPayloadType>,
    ): Promise<AppendToStreamResultWithGlobalPosition> =>
      collector.instrumentAppend(
        streamName,
        events,
        async (scope) => {
          await init();
          // TODO: This has to be smarter when we introduce urn-based resolution
          const [firstPart, ...rest] = streamName.split('-');

          const streamType =
            firstPart && rest.length > 0 ? firstPart : unknownTag;

          const appendResult = await session.pool.withConnection(
            (connection) =>
              appendToStream(connection, streamName, streamType, events, {
                ...(appendOptions as AppendToStreamOptions),
                databaseSchemaName: databaseSchema.databaseSchemaName,
                messageIdGenerator: () =>
                  observability.contextGenerator.generateMessageId(),
                context: scope.context,
                onBeforeCommit: async (messages, context) => {
                  if (inlineProjections.length > 0)
                    await collector.instrumentInlineProjection(
                      streamName,
                      scope,
                      (observabilityScope) =>
                        handleProjections({
                          projections: inlineProjections,
                          events: messages,
                          ...transactionToSQLiteProjectionHandlerContext(
                            session,
                            context.transaction,
                          ),
                          migrationOptions: databaseSchema,
                          observabilityScope,
                        }),
                    );

                  if (onBeforeCommitHook)
                    await onBeforeCommitHook(messages, context);
                },
              }),
            { readonly: false },
          );

          if (!appendResult.success)
            throw new ExpectedVersionConflictError(
              -1n, //TODO: Return actual version in case of error
              appendOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
            );

          return {
            nextExpectedStreamVersion: appendResult.nextStreamPosition,
            lastEventGlobalPosition: bigIntProcessorCheckpoint(
              appendResult.lastGlobalPosition,
            ),
            createdNewStream:
              appendResult.nextStreamPosition >= BigInt(events.length),
          };
        },
        appendOptions?.observability,
      ),

    async streamExists(
      streamName: string,
      options?: SQLiteStreamExistsOptions,
    ): Promise<StreamExistsResult> {
      await init();
      return streamExists(session.pool.execute, streamName, {
        ...options,
        databaseSchemaName: databaseSchema.databaseSchemaName,
      });
    },

    consumer: <ConsumerMessageType extends Message = AnyMessage>(
      consumerOptions?: SQLiteEventStoreConsumerConfig<ConsumerMessageType>,
    ): SQLiteEventStoreConsumer<ConsumerMessageType> =>
      sqliteEventStoreConsumer<ConsumerMessageType, Driver>({
        ...(options ?? {}),
        ...consumerOptions,
        schema: databaseSchema,
        observability: mergeObservability(
          options.observability,
          consumerOptions?.observability,
        ),
        pool: session.pool,
      }),

    async withSession<T = unknown>(
      callback: (session: EventStoreSession<SQLiteEventStore>) => Promise<T>,
    ): Promise<T> {
      await init();

      return await session.pool.withConnection((connection) =>
        callback({
          eventStore: storeFor(sessionFor(connection)),
          close: () => Promise.resolve(),
        }),
      );
    },

    close: () => session.pool.close(),
    schema: {
      get component() {
        return eventStoreSchema.component;
      },
      sql: () => eventStoreSchema.migrator.sql(),
      print: () => eventStoreSchema.migrator.print(),
      migrate,
      ensureMigrated,
      dangerous: {
        truncate: async (truncateOptions?: {
          truncateProjections?: boolean;
        }): Promise<void> => {
          await init();
          await session.pool.withTransaction(async (transaction) => {
            await truncateTables(transaction.execute, {
              databaseSchemaName: databaseSchema.databaseSchemaName,
            });

            if (truncateOptions?.truncateProjections) {
              const projectionContext =
                transactionToSQLiteProjectionHandlerContext(
                  session,
                  transaction,
                );

              for (const { projection } of projectionRegistrations) {
                if (projection.truncate)
                  await projection.truncate({
                    ...projectionContext,
                    migrationOptions: databaseSchema,
                    observabilityScope: noopScope,
                  });
              }
            }
          });
        },
      },
    },
  });

  return storeFor(session);
};
