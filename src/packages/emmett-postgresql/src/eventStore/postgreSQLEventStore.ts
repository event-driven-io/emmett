import {
  dumbo,
  type MigrationStyle,
  type NodePostgresClientConnection,
  type NodePostgresConnector,
  type NodePostgresPool,
  type NodePostgresPoolClientConnection,
} from '@event-driven-io/dumbo';
import {
  assertExpectedVersionMatchesCurrent,
  downcastRecordedMessages,
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type BigIntStreamPosition,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type StreamExistsResult,
} from '@event-driven-io/emmett';
import pg from 'pg';
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
  readStream,
  schemaSQL,
  streamExists,
  unknownTag,
  type AppendToStreamBeforeCommitHook,
  type PostgresStreamExistsOptions,
} from './schema';
import { truncateTables } from './schema/truncateTables';

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
    options?: AppendToStreamOptions<
      BigIntStreamPosition,
      EventType,
      EventPayloadType
    >,
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
    migrate(): Promise<void>;
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
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      pooled: true;
      pool: pg.Pool;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      pool: pg.Pool;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      pooled: true;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
    };

type PostgresEventStoreNotPooledOptions =
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      pooled: false;
      client: pg.Client;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      client: pg.Client;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      pooled: false;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      connection:
        | NodePostgresPoolClientConnection
        | NodePostgresClientConnection;
      pooled?: false;
    }
  | {
      connector?: NodePostgresConnector;
      connectionString?: string;
      database?: string;
      dumbo: NodePostgresPool;
      pooled?: false;
    };

export type PostgresEventStoreConnectionOptions =
  | PostgresEventStorePooledOptions
  | PostgresEventStoreNotPooledOptions;

export type PostgresEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    PostgresReadEventMetadata,
    PostgreSQLProjectionHandlerContext
  >[];
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
};

export const defaultPostgreSQLOptions: PostgresEventStoreOptions = {
  projections: [],
  schema: { autoMigration: 'CreateOrUpdate' },
};

export const PostgreSQLEventStoreDefaultStreamVersion = 0n;

export const getPostgreSQLEventStore = (
  connectionString: string,
  options: PostgresEventStoreOptions = defaultPostgreSQLOptions,
): PostgresEventStore => {
  const poolOptions = {
    connectionString,
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const pool = 'dumbo' in poolOptions ? poolOptions.dumbo : dumbo(poolOptions);
  let migrateSchema: Promise<void> | undefined = undefined;

  const autoGenerateSchema =
    options.schema?.autoMigration === undefined ||
    options.schema?.autoMigration !== 'None';

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const migrate = async () => {
    if (!migrateSchema) {
      migrateSchema = createEventStoreSchema(connectionString, pool, {
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
                context,
              });
            }
          }
          if (options.hooks?.onAfterSchemaCreated) {
            await options.hooks.onAfterSchemaCreated(context);
          }
        },
      });
    }
    return migrateSchema;
  };

  const ensureSchemaExists = () => {
    if (!autoGenerateSchema) return Promise.resolve();

    return migrate();
  };

  const beforeCommitHook: AppendToStreamBeforeCommitHook | undefined =
    inlineProjections.length > 0
      ? (events, { transaction }) =>
          handleProjections({
            projections: inlineProjections,
            connection: {
              connectionString,
              pool,
              transaction,
            },
            // TODO: Add proper handling of global data
            // Currently it's not available as append doesn't return array of global position but just the last one
            events: events as ReadEvent<Event, PostgresReadEventMetadata>[],
          })
      : undefined;

  return {
    schema: {
      sql: () => schemaSQL.join(''),
      print: () => console.log(schemaSQL.join('')),
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
                  await projection.projection.truncate(projectionContext);
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
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();

      const result = await this.readStream<EventType, EventPayloadType>(
        streamName,
        read,
      );
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

    readStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options?: ReadStreamOptions<
        BigIntStreamPosition,
        EventType,
        EventPayloadType
      >,
    ): Promise<ReadStreamResult<EventType, PostgresReadEventMetadata>> => {
      await ensureSchemaExists();
      return readStream<EventType, EventPayloadType>(
        pool.execute,
        streamName,
        options,
      );
    },

    appendToStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<
        BigIntStreamPosition,
        EventType,
        EventPayloadType
      >,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      await ensureSchemaExists();
      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType = firstPart && rest.length > 0 ? firstPart : unknownTag;

      const appendResult = await appendToStream(
        pool,
        streamName,
        streamType,
        downcastRecordedMessages(events, options?.schema?.versioning),
        {
          ...(options as AppendToStreamOptions),
          beforeCommitHook,
        },
      );

      if (!appendResult.success)
        throw new ExpectedVersionConflictError<bigint>(
          -1n, //TODO: Return actual version in case of error
          options?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
        );

      return {
        nextExpectedStreamVersion: appendResult.nextStreamPosition,
        lastEventGlobalPosition:
          appendResult.globalPositions[
            appendResult.globalPositions.length - 1
          ]!,
        createdNewStream:
          appendResult.nextStreamPosition >= BigInt(events.length),
      };
    },

    streamExists: async (
      streamName: string,
      options?: PostgresStreamExistsOptions,
    ): Promise<StreamExistsResult> => {
      await ensureSchemaExists();
      return streamExists(pool.execute, streamName, options);
    },

    consumer: <ConsumerEventType extends Event = Event>(
      options?: PostgreSQLEventStoreConsumerConfig<ConsumerEventType>,
    ): PostgreSQLEventStoreConsumer<ConsumerEventType> =>
      postgreSQLEventStoreConsumer<ConsumerEventType>({
        ...(options ?? {}),
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
