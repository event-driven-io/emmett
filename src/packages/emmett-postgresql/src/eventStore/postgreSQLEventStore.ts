import type { ObservabilityScope } from '@event-driven-io/almanac';
import {
  dumbo,
  fromDatabaseDriverType,
  getFormatter,
  SQL,
  type MigrationStyle,
  type RunSQLMigrationsResult,
} from '@event-driven-io/dumbo';
import type {
  PgClientConnection,
  PgDriverType,
  PgPool,
  PgPoolClientConnection,
  PgTransactionOptions,
} from '@event-driven-io/dumbo/pg';
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
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type EmmettObservabilityConfig,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type JSONSerializationOptions,
  type ProjectionRegistration,
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
  PostgreSQLEventStoreCheckpoint,
  readStream,
  schemaSQL,
  streamExists,
  type AppendToStreamBeforeCommitHook,
  type CreateEventStoreSchemaOptions,
  type PostgresStreamExistsOptions,
} from './schema';
import { truncateTables } from './schema/truncateTables';
import { withNestedTransactionOptions } from './transactionOptions';

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
  consumer<ConsumerEventType extends Event = Event>(
    options?: PostgreSQLEventStoreConsumerConfig<ConsumerEventType>,
  ): PostgreSQLEventStoreConsumer<ConsumerEventType>;
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

export type PostgresEventStoreConnectionOptions = (
  PostgresEventStorePooledOptions | PostgresEventStoreNotPooledOptions
) & {
  transactionOptions?: PgTransactionOptions | undefined;
};

export type PostgresEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext
  >[];
  observability?: EmmettObservabilityConfig;
  schema?: { autoMigration?: MigrationStyle };
  connectionOptions?: PostgresEventStoreConnectionOptions;
  hooks?: {
    /**
     * This hook will be called **BEFORE** event store schema is created
     */
    onBeforeSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext,
    ) => Promise<void> | void;
    /**
     * This hook will be called **AFTER** event store schema was created but before transaction commits
     */
    onAfterSchemaCreated?: (
      context: PostgreSQLProjectionHandlerContext,
    ) => Promise<void> | void;
  };
} & JSONSerializationOptions;

export const defaultPostgreSQLOptions: PostgresEventStoreOptions = {
  projections: [],
  schema: { autoMigration: 'CreateOrUpdate' },
};

export const PostgreSQLEventStoreDefaultStreamVersion = 0n;

export const getPostgreSQLEventStore = (
  connectionString: string,
  options: PostgresEventStoreOptions = defaultPostgreSQLOptions,
): PostgresEventStore => {
  const rawPoolOptions = {
    connectionString,
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const poolOptions = withNestedTransactionOptions<
    PostgresEventStoreConnectionOptions & { connectionString: string },
    PgTransactionOptions
  >(rawPoolOptions);
  const pool: PgPool =
    'dumbo' in poolOptions
      ? (poolOptions.dumbo as PgPool)
      : (dumbo({
          ...poolOptions,
          serialization: options.serialization,
        }) as PgPool);
  let migrateSchema: Promise<RunSQLMigrationsResult> | undefined = undefined;

  const autoGenerateSchema =
    options.schema?.autoMigration === undefined ||
    options.schema?.autoMigration !== 'None';

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);
  const observability = eventStoreObservability(options);
  const collector = eventStoreCollector(observability);

  const migrate = async (migrationOptions?: CreateEventStoreSchemaOptions) => {
    if (!migrateSchema) {
      // TODO: Fix this cast when introducing more drivers
      migrateSchema = createEventStoreSchema(
        connectionString,
        pool,
        {
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
                    migrationOptions,
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
        migrationOptions,
      );

      return migrateSchema;
    }
    const result = await migrateSchema;

    if (migrationOptions?.dryRun) {
      // In case of dry run we want to reset the state so that actual migration can be run later
      migrateSchema = undefined;
    }

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
            serialization: options.serialization ?? readOptions?.serialization,
          },
        );
      },
      readOptions?.observability,
    );

  const beforeCommitHook = (
    streamName: string,
    appendScope: ObservabilityScope,
  ): AppendToStreamBeforeCommitHook | undefined =>
    inlineProjections.length > 0
      ? async (events, { transaction }) =>
          collector.instrumentInlineProjection(
            streamName,
            appendScope,
            async (observabilityScope) =>
              handleProjections({
                projections: inlineProjections,
                // TODO: Add proper handling of global data
                // Currently it's not available as append doesn't return array of global position but just the last one
                events: events as ReadEvent<Event, PostgresReadEventMetadata>[],
                ...(await transactionToPostgreSQLProjectionHandlerContext(
                  connectionString,
                  pool,
                  transaction,
                )),
                observabilityScope,
              }),
          )
      : undefined;

  return {
    schema: {
      sql: () =>
        SQL.describe(
          schemaSQL,
          getFormatter(fromDatabaseDriverType(pool.driverType).databaseType),
        ),
      print: () =>
        console.log(
          SQL.describe(
            schemaSQL,
            getFormatter(fromDatabaseDriverType(pool.driverType).databaseType),
          ),
        ),
      migrate,
      dangerous: {
        truncate: (truncateOptions?: {
          resetSequences?: boolean;
          truncateProjections?: boolean;
        }): Promise<void> =>
          pool.withTransaction(async (transaction) => {
            await ensureSchemaExists();
            await truncateTables(transaction.execute, truncateOptions);

            if (truncateOptions?.truncateProjections) {
              const projectionContext =
                await transactionToPostgreSQLProjectionHandlerContext(
                  connectionString,
                  pool,
                  transaction,
                );
              for (const projection of options?.projections ?? []) {
                if (projection.projection.truncate)
                  await projection.projection.truncate({
                    ...projectionContext,
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
                beforeCommitHook: beforeCommitHook(streamName, scope),
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
      return streamExists(pool.execute, streamName, options);
    },

    consumer: <ConsumerEventType extends Event = Event>(
      consumerOptions?: PostgreSQLEventStoreConsumerConfig<ConsumerEventType>,
    ): PostgreSQLEventStoreConsumer<ConsumerEventType> =>
      postgreSQLEventStoreConsumer<ConsumerEventType>({
        ...consumerOptions,
        observability: mergeObservability(
          options.observability,
          consumerOptions?.observability,
        ),
        pool,
        connectionString,
      }),

    close: () => pool.close(),

    async withSession<T = unknown>(
      callback: (session: EventStoreSession<PostgresEventStore>) => Promise<T>,
    ): Promise<T> {
      return await pool.withConnection(async (connection) => {
        const storeOptions: PostgresEventStoreOptions = {
          ...options,
          connectionOptions: {
            connection,
          },
          schema: {
            ...(options.schema ?? {}),
            autoMigration: 'None',
          },
        };

        const eventStore = getPostgreSQLEventStore(
          connectionString,
          storeOptions,
        );

        return ensureSchemaExists().then(() =>
          callback({
            eventStore,
            close: () => Promise.resolve(),
          }),
        );
      });
    },
  };
};
