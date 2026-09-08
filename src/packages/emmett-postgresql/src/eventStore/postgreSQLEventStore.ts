import type { ObservabilityScope } from '@event-driven-io/almanac';
import {
  dumbo,
  fromDatabaseDriverType,
  getFormatter,
  JSONSerializer,
  type MigrationStyle,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type {
  PgClientConnection,
  PgConnection,
  PgDriverType,
  PgPool,
  PgPoolClientConnection,
  PgPoolOptions,
  PgTransaction,
} from '@event-driven-io/dumbo/pg';
import { pgEventStoreDriver, type PgEventStoreDriver } from '../pg';
import {
  assertExpectedVersionMatchesCurrent,
  downcastRecordedMessages,
  eventStoreCollector,
  eventStoreObservability,
  ExpectedVersionConflictError,
  mergeObservability,
  NO_CONCURRENCY_CHECK,
  noopScope,
  unknownTag,
  withOperationScope,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AnyMessage,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type EmmettObservabilityConfig,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type JSONSerializationOptions,
  type Message,
  type ProjectionRegistration,
  type BeforeEventStoreCommitHandler,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type StreamExistsResult,
} from '@event-driven-io/emmett';
import type pg from 'pg';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerConfig,
} from './consumers';
import {
  handleProjections,
  transactionToPostgreSQLProjectionHandlerContext,
  type PostgreSQLProjectionHandlerContext,
} from './projections';
import {
  appendToStream,
  createEventStoreSchema,
  eventStoreDatabaseSchema,
  eventStoreSchemaSQL,
  PostgreSQLEventStoreCheckpoint,
  readStream,
  streamExists,
  type AppendToStreamBeforeCommitHook,
  type CreateEventStoreSchemaOptions,
  type EventStoreDatabaseSchemaOptions,
  type PostgresStreamExistsOptions,
} from './schema';
import { truncateTables } from './schema/truncateTables';
import type {
  AnyPostgreSQLEventStoreDriver,
  PoolOrConnectionOptions,
} from './eventStoreDriver';

export interface PostgresEventStore
  extends
    EventStore<PostgresReadEventMetadata>,
    EventStoreSessionFactory<PostgresEventStore> {
  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<EventType, EventPayloadType>,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerMessageType extends Message = AnyMessage>(
    options?: PostgreSQLEventStoreConsumerConfig<ConsumerMessageType>,
  ): PostgreSQLEventStoreConsumer<ConsumerMessageType>;
  close(): Promise<void>;
  streamExists(
    streamName: string,
    options?: PostgresStreamExistsOptions,
  ): Promise<StreamExistsResult>;
  schema: {
    sql(): string;
    print(): void;
    migrate(
      options?: CreateEventStoreSchemaOptions,
    ): Promise<RunSQLMigrationsResult>;
    dangerous: {
      truncate(options?: {
        resetSequences?: boolean;
        truncateProjections?: boolean;
      }): Promise<void>;
    };
  };
}

export type PostgresReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type PostgresReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  PostgresReadEventMetadata
>;

type PostgresEventStorePooledOptions =
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      pooled: true;
      pool: pg.Pool;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      pool: pg.Pool;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      pooled: true;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
    };

type PostgresEventStoreNotPooledOptions =
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      pooled: false;
      client: pg.Client;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      client: pg.Client;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      pooled: false;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      connection: PgPoolClientConnection | PgClientConnection;
      pooled?: false;
    }
  | {
      connector?: PgDriverType;
      connectionString?: string;
      database?: string;
      dumbo: PgPool;
      pooled?: false;
    };

export type PostgresEventStoreConnectionOptions =
  PostgresEventStorePooledOptions | PostgresEventStoreNotPooledOptions;

export type PostgresEventStoreOptions<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = {
  driver: Driver;
  projections?: ProjectionRegistration<
    'inline',
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext<Driver>
  >[];
  observability?: EmmettObservabilityConfig;
  schema?: { autoMigration?: MigrationStyle } & EventStoreDatabaseSchemaOptions;
  hooks?: {
    /**
     * This hook will be called **BEFORE** event store schema is created
     */
    onBeforeSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext<Driver>,
    ) => Promise<void> | void;
    /**
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<PostgresEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      PostgresEventStore,
      {
        connection: PgConnection;
        transaction: PgTransaction;
      }
    >;
    /**
     * This hook will be called **AFTER** event store schema was created but before transaction commits
     */
    onAfterSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext<Driver>,
    ) => Promise<void> | void;
  };
} & PoolOrConnectionOptions<Driver> &
  JSONSerializationOptions;

/**
 * @deprecated use `PostgresEventStoreOptions` instead; this alias is removed in
 * the next major.
 */
export type PostgresEventStoreDriverOptions<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
> = PostgresEventStoreOptions<Driver>;

/**
 * Options for the `getPostgreSQLEventStore(connectionString, options)` form.
 *
 * @deprecated pass an options object carrying `driver` instead; this form is
 * removed in the next major.
 */
export type PostgresEventStoreConnectionStringOptions = {
  projections?: ProjectionRegistration<
    'inline',
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext
  >[];
  observability?: EmmettObservabilityConfig;
  schema?: { autoMigration?: MigrationStyle } & EventStoreDatabaseSchemaOptions;
  hooks?: {
    /**
     * This hook will be called **BEFORE** event store schema is created
     */
    onBeforeSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext,
    ) => Promise<void> | void;
    /**
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<PostgresEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      PostgresEventStore,
      {
        connection: PgConnection;
        transaction: PgTransaction;
      }
    >;
    /**
     * This hook will be called **AFTER** event store schema was created but before transaction commits
     */
    onAfterSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext,
    ) => Promise<void> | void;
  };
  connectionOptions?: PostgresEventStoreConnectionOptions;
} & JSONSerializationOptions;

export const defaultPostgreSQLOptions: PostgresEventStoreConnectionStringOptions =
  {
    projections: [],
    schema: { autoMigration: 'CreateOrUpdate' },
  };

export const PostgreSQLEventStoreDefaultStreamVersion = 0n;

/**
 * @deprecated pass an options object carrying `driver` instead; this form is
 * removed in the next major.
 */
export function getPostgreSQLEventStore(
  connectionString: string,
  options?: PostgresEventStoreConnectionStringOptions,
): PostgresEventStore;
export function getPostgreSQLEventStore<
  Driver extends AnyPostgreSQLEventStoreDriver = AnyPostgreSQLEventStoreDriver,
>(options: PostgresEventStoreOptions<Driver>): PostgresEventStore;
export function getPostgreSQLEventStore(
  connectionStringOrOptions: string | PostgresEventStoreOptions,
  maybeOptions: PostgresEventStoreConnectionStringOptions = defaultPostgreSQLOptions,
): PostgresEventStore {
  const optionsWithDriver =
    typeof connectionStringOrOptions === 'string'
      ? undefined
      : connectionStringOrOptions;

  const options: PostgresEventStoreOptions = optionsWithDriver
    ? optionsWithDriver
    : (maybeOptions as PostgresEventStoreOptions);

  const poolOptions = {
    connectionString:
      typeof connectionStringOrOptions === 'string'
        ? connectionStringOrOptions
        : '',
    ...(optionsWithDriver ? {} : (maybeOptions.connectionOptions ?? {})),
  };
  /**
   * Built even when a pool is supplied, so the handler context always carries
   * the options the driver would have connected with.
   */
  // TODO: Fix this cast when introducing more drivers
  const dumboOptions = (
    optionsWithDriver
      ? optionsWithDriver.driver.mapToDumboOptions(optionsWithDriver)
      : pgEventStoreDriver.mapToDumboOptions({
          connectionString: poolOptions.connectionString,
          connectionOptions: poolOptions,
        })
  ) as PgPoolOptions;

  // TODO: Fix this cast when introducing more drivers
  const eventStoreDriver = (optionsWithDriver?.driver ??
    pgEventStoreDriver) as PgEventStoreDriver;

  // TODO: Fix this cast when introducing more drivers
  const pool = (
    optionsWithDriver
      ? (optionsWithDriver.pool ??
        dumbo({ serialization: options.serialization, ...dumboOptions }))
      : 'dumbo' in poolOptions
        ? poolOptions.dumbo
        : dumbo({ serialization: options.serialization, ...dumboOptions })
  ) as PgPool;

  const session = {
    pool,
    driver: eventStoreDriver,
    connectionOptions: dumboOptions,
  };

  let migrateSchema: Promise<RunSQLMigrationsResult> | undefined = undefined;

  const autoGenerateSchema =
    options.schema?.autoMigration === undefined ||
    options.schema?.autoMigration !== 'None';

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);
  const databaseSchema = eventStoreDatabaseSchema(options.schema);
  const observability = eventStoreObservability(options);
  const collector = eventStoreCollector(observability);

  const migrate = async (migrationOptions?: CreateEventStoreSchemaOptions) => {
    if (!migrateSchema) {
      const migrationSchemaOptions = {
        ...options.schema,
        ...migrationOptions,
      };
      const schemaMigrationOptions = {
        ...migrationSchemaOptions,
        ...eventStoreDatabaseSchema(migrationSchemaOptions),
      };

      // TODO: Fix this cast when introducing more drivers
      const migration = createEventStoreSchema({
        ...session,
        hooks: {
          onBeforeSchemaCreated: async (context) => {
            if (options.hooks?.onBeforeSchemaCreated) {
              await options.hooks.onBeforeSchemaCreated(context);
            }
          },
          onAfterSchemaCreated: async (context) => {
            for (const projection of inlineProjections) {
              if (projection.init) {
                await projection.init({
                  version: projection.version ?? 1,
                  status: 'active',
                  registrationType: 'inline',
                  context: {
                    ...context,
                    migrationOptions: schemaMigrationOptions,
                    observabilityScope: noopScope,
                  },
                });
              }
            }
            if (options.hooks?.onAfterSchemaCreated) {
              await options.hooks.onAfterSchemaCreated(context);
            }
          },
        },
        schema: schemaMigrationOptions,
      });

      if (migrationOptions?.dryRun) {
        return migration;
      }

      migrateSchema = migration;
      return migration;
    }
    const result = await migrateSchema;

    return { applied: [], skipped: result.applied.concat(result.skipped) };
  };

  const ensureSchemaExists = () => {
    if (!autoGenerateSchema) return Promise.resolve();

    return migrate();
  };

  const readStreamFromPostgreSQL = <
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    readOptions?: ReadStreamOptions<EventType, EventPayloadType>,
  ): Promise<ReadStreamResult<EventType, PostgresReadEventMetadata>> =>
    collector.instrumentRead(
      streamName,
      async () => {
        await ensureSchemaExists();
        return readStream<EventType, EventPayloadType>(
          pool.execute,
          streamName,
          {
            ...readOptions,
            databaseSchemaName: databaseSchema.databaseSchemaName,
            serialization: options.serialization ?? readOptions?.serialization,
          },
        );
      },
      readOptions?.observability,
    );

  const onBeforeCommitHook = options.hooks?.onBeforeCommit;

  const beforeCommitHook = (
    streamName: string,
    appendScope: ObservabilityScope,
  ): AppendToStreamBeforeCommitHook | undefined =>
    inlineProjections.length > 0 || onBeforeCommitHook
      ? async (events, context) => {
          if (inlineProjections.length > 0)
            await collector.instrumentInlineProjection(
              streamName,
              appendScope,
              async (observabilityScope) =>
                handleProjections({
                  projections: inlineProjections,
                  // TODO: Add proper handling of global data
                  // Currently it's not available as append doesn't return array of global position but just the last one
                  events: events as ReadEvent<
                    Event,
                    PostgresReadEventMetadata
                  >[],
                  ...transactionToPostgreSQLProjectionHandlerContext(
                    session,
                    context.transaction,
                  ),
                  migrationOptions: databaseSchema,
                  observabilityScope,
                }),
            );

          if (onBeforeCommitHook)
            await onBeforeCommitHook(
              events as ReadEvent<Event, PostgresReadEventMetadata>[],
              context,
            );
        }
      : undefined;

  const eventStoreSchemaDescription = (): string =>
    getFormatter(fromDatabaseDriverType(pool.driverType).databaseType).describe(
      eventStoreSchemaSQL(options.schema),
      { serializer: JSONSerializer },
    );

  return {
    schema: {
      sql: eventStoreSchemaDescription,
      print: () => console.log(eventStoreSchemaDescription()),
      migrate,
      dangerous: {
        truncate: (truncateOptions?: {
          resetSequences?: boolean;
          truncateProjections?: boolean;
        }): Promise<void> =>
          pool.withTransaction(async (transaction) => {
            await ensureSchemaExists();
            await truncateTables(transaction.execute, {
              ...truncateOptions,
              databaseSchemaName: databaseSchema.databaseSchemaName,
            });

            if (truncateOptions?.truncateProjections) {
              const projectionContext =
                transactionToPostgreSQLProjectionHandlerContext(
                  session,
                  transaction,
                );
              for (const projection of options?.projections ?? []) {
                if (projection.projection.truncate)
                  await projection.projection.truncate({
                    ...projectionContext,
                    migrationOptions: databaseSchema,
                    observabilityScope: noopScope,
                  });
              }
            }
          }),
      },
    },
    async aggregateStream<
      State,
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        PostgresReadEventMetadata,
        EventPayloadType
      >,
    ): Promise<AggregateStreamResult<State>> {
      return collector.instrumentAggregate(
        streamName,
        async (scope) => {
          const { evolve, initialState, read } = options;

          const expectedStreamVersion = read?.expectedStreamVersion;

          let state = initialState();

          const result = await readStreamFromPostgreSQL<
            EventType,
            EventPayloadType
          >(streamName, {
            ...(read ?? {}),
            observability: withOperationScope(scope, read?.observability),
          });
          const currentStreamVersion = result.currentStreamVersion;

          assertExpectedVersionMatchesCurrent(
            currentStreamVersion,
            expectedStreamVersion,
            PostgreSQLEventStoreDefaultStreamVersion,
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
    ): Promise<ReadStreamResult<EventType, PostgresReadEventMetadata>> =>
      readStreamFromPostgreSQL(streamName, readOptions),

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
          await ensureSchemaExists();
          // TODO: This has to be smarter when we introduce urn-based resolution
          const [firstPart, ...rest] = streamName.split('-');

          const streamType =
            firstPart && rest.length > 0 ? firstPart : unknownTag;

          const appendResult = await pool.withConnection(async (connection) =>
            appendToStream(
              // TODO: Fix this when introducing more drivers
              connection,
              streamName,
              streamType,
              downcastRecordedMessages(
                events,
                appendOptions?.schema?.versioning,
              ),
              {
                ...(appendOptions as AppendToStreamOptions),
                messageIdGenerator: () =>
                  observability.contextGenerator.generateMessageId(),
                context: scope.context,
                beforeCommitHook: beforeCommitHook(streamName, scope),
                databaseSchemaName: databaseSchema.databaseSchemaName,
              },
            ),
          );

          if (!appendResult.success)
            throw new ExpectedVersionConflictError(
              -1n, //TODO: Return actual version in case of error
              appendOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
            );

          return {
            nextExpectedStreamVersion: appendResult.nextStreamPosition,
            lastEventGlobalPosition:
              PostgreSQLEventStoreCheckpoint.toProcessorCheckpoint(
                appendResult.checkpoints[appendResult.checkpoints.length - 1]!,
              ),
            createdNewStream:
              appendResult.nextStreamPosition >= BigInt(events.length),
          };
        },
        appendOptions?.observability,
      ),

    streamExists: async (
      streamName: string,
      options?: PostgresStreamExistsOptions,
    ): Promise<StreamExistsResult> => {
      await ensureSchemaExists();
      return streamExists(pool.execute, streamName, {
        ...options,
        databaseSchemaName: databaseSchema.databaseSchemaName,
      });
    },

    consumer: <ConsumerMessageType extends Message = AnyMessage>(
      consumerOptions?: PostgreSQLEventStoreConsumerConfig<ConsumerMessageType>,
    ): PostgreSQLEventStoreConsumer<ConsumerMessageType> =>
      postgreSQLEventStoreConsumer<ConsumerMessageType>({
        ...consumerOptions,
        schema: databaseSchema,
        observability: mergeObservability(
          options.observability,
          consumerOptions?.observability,
        ),
        pool,
        /**
         * The consumer's own `connectionString` option is deprecated and pg
         * specific, so it is read back out of the pg connection context.
         */
        connectionString: dumboOptions.connectionString,
      }),

    close: () => pool.close(),

    async withSession<T = unknown>(
      callback: (session: EventStoreSession<PostgresEventStore>) => Promise<T>,
    ): Promise<T> {
      return await pool.withConnection(async (connection) => {
        const storeOptions: PostgresEventStoreConnectionStringOptions = {
          ...options,
          connectionOptions: {
            connection: connection,
          },
          schema: {
            ...(options.schema ?? {}),
            autoMigration: 'None',
          },
        };

        const eventStore = optionsWithDriver
          ? getPostgreSQLEventStore({
              ...optionsWithDriver,
              pool: dumbo({
                serialization: options.serialization,
                ...dumboOptions,
                connection,
              }),
              schema: {
                ...(options.schema ?? {}),
                autoMigration: 'None',
              },
            })
          : getPostgreSQLEventStore(poolOptions.connectionString, storeOptions);

        return ensureSchemaExists().then(() =>
          callback({
            eventStore,
            close: () => Promise.resolve(),
          }),
        );
      });
    },
  };
}
