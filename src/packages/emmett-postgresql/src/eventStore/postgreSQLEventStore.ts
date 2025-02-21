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
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import pg from 'pg';
import {
  postgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumer,
  type PostgreSQLEventStoreConsumerConfig,
} from './consumers';
import {
  handleProjections,
  type PostgreSQLProjectionHandlerContext,
} from './projections';
import {
  appendToStream,
  createEventStoreSchema,
  readStream,
  schemaSQL,
  type AppendToStreamPreCommitHook,
} from './schema';

export interface PostgresEventStore
  extends EventStore<PostgresReadEventMetadata>,
    EventStoreSessionFactory<PostgresEventStore> {
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerEventType extends Event = Event>(
    options?: PostgreSQLEventStoreConsumerConfig<ConsumerEventType>,
  ): PostgreSQLEventStoreConsumer<ConsumerEventType>;
  close(): Promise<void>;
  schema: {
    sql(): string;
    print(): void;
    migrate(): Promise<void>;
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
  let migrateSchema: Promise<void>;

  const autoGenerateSchema =
    options.schema?.autoMigration === undefined ||
    options.schema?.autoMigration !== 'None';

  const ensureSchemaExists = () => {
    if (!autoGenerateSchema) return Promise.resolve();

    if (!migrateSchema) {
      migrateSchema = createEventStoreSchema(pool);
    }
    return migrateSchema;
  };

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const preCommitHook: AppendToStreamPreCommitHook | undefined =
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
      migrate: async () => {
        await (migrateSchema = createEventStoreSchema(pool));
      },
    },
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        PostgresReadEventMetadata
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();

      const result = await this.readStream<EventType>(streamName, options.read);
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

    readStream: async <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<ReadStreamResult<EventType, PostgresReadEventMetadata>> => {
      await ensureSchemaExists();
      return readStream<EventType>(pool.execute, streamName, options);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      await ensureSchemaExists();
      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType =
        firstPart && rest.length > 0 ? firstPart : 'emt:unknown';

      const appendResult = await appendToStream(
        pool,
        streamName,
        streamType,
        events,
        {
          ...options,
          preCommitHook,
        },
      );

      if (!appendResult.success)
        throw new ExpectedVersionConflictError<bigint>(
          -1n, //TODO: Return actual version in case of error
          options?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
        );

      return {
        nextExpectedStreamVersion: appendResult.nextStreamPosition,
        lastEventGlobalPosition: appendResult.lastGlobalPosition,
        createdNewStream:
          appendResult.nextStreamPosition >= BigInt(events.length),
      };
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
        };

        const eventStore = getPostgreSQLEventStore(
          connectionString,
          storeOptions,
        );

        return callback({
          eventStore,
          close: () => Promise.resolve(),
        });
      });
    },
  };
};
