import {
  dumbo,
  endPool,
  type NodePostgresClientConnection,
  type NodePostgresConnector,
  type NodePostgresPoolClientConnection,
} from '@event-driven-io/dumbo';
import {
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  STREAM_DOES_NOT_EXIST,
  STREAM_EXISTS,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultStreamVersionType,
  type Event,
  type EventStore,
  type EventStoreSession,
  type EventStoreSessionFactory,
  type ExpectedStreamVersion,
  type ProjectionRegistration,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import pg from 'pg';
import {
  defaultPostgreSQLProjectionOptions,
  handleProjections,
  type PostgreSQLProjectionHandlerContext,
} from './projections';
import {
  appendToStream,
  createEventStoreSchema,
  readStream,
  type AppendToStreamPreCommitHook,
} from './schema';

export interface PostgresEventStore
  extends EventStore<
      DefaultStreamVersionType,
      ReadEventMetadataWithGlobalPosition
    >,
    EventStoreSessionFactory<PostgresEventStore, DefaultStreamVersionType> {
  close(): Promise<void>;
  schema: {
    migrate(): Promise<void>;
  };
}

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
    };

export type PostgresEventStoreConnectionOptions =
  | PostgresEventStorePooledOptions
  | PostgresEventStoreNotPooledOptions;

export type PostgresEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    PostgreSQLProjectionHandlerContext
  >[];
  connectionOptions?: PostgresEventStoreConnectionOptions;
};
export const getPostgreSQLEventStore = (
  connectionString: string,
  options: PostgresEventStoreOptions = defaultPostgreSQLProjectionOptions,
): PostgresEventStore => {
  const poolOptions = {
    connectionString,
    ...(options.connectionOptions ? options.connectionOptions : {}),
  };
  const pool = dumbo(poolOptions);
  const ensureSchemaExists = createEventStoreSchema(pool);

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
              transaction,
            },
            events,
          })
      : undefined;

  return {
    schema: {
      migrate: async () => {
        await ensureSchemaExists;
      },
    },
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<State, EventType>,
    ): Promise<AggregateStreamResult<State> | null> {
      await ensureSchemaExists;
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();

      const result = await this.readStream<EventType>(streamName, options.read);

      if (result === null) return null;

      const currentStreamVersion = result.currentStreamVersion;

      assertExpectedVersionMatchesCurrent(
        currentStreamVersion,
        expectedStreamVersion,
      );

      for (const event of result.events) {
        if (!event) continue;

        state = evolve(state, event);
      }

      return {
        currentStreamVersion: currentStreamVersion,
        state,
      };
    },

    readStream: async <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions,
    ): Promise<
      ReadStreamResult<
        EventType,
        DefaultStreamVersionType,
        ReadEventMetadataWithGlobalPosition
      >
    > => {
      await ensureSchemaExists;
      return readStream<EventType>(pool.execute, streamName, options);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      await ensureSchemaExists;
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

      return { nextExpectedStreamVersion: appendResult.nextStreamPosition };
    },
    close: () => endPool({ connectionString }),

    async withSession<T = unknown>(
      callback: (
        session: EventStoreSession<
          PostgresEventStore,
          DefaultStreamVersionType
        >,
      ) => Promise<T>,
    ): Promise<T> {
      const connection = await pool.connection();

      try {
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

        const session = { eventStore, close: () => connection.close() };

        return await callback(session);
      } finally {
        await connection.close();
      }
    },
  };
};

const matchesExpectedVersion = (
  current: bigint | undefined,
  expected: ExpectedStreamVersion,
): boolean => {
  if (expected === NO_CONCURRENCY_CHECK) return true;

  if (expected == STREAM_DOES_NOT_EXIST) return current === undefined;

  if (expected == STREAM_EXISTS) return current !== undefined;

  return current === expected;
};

const assertExpectedVersionMatchesCurrent = (
  current: bigint | undefined,
  expected: ExpectedStreamVersion | undefined,
): void => {
  expected ??= NO_CONCURRENCY_CHECK;

  if (!matchesExpectedVersion(current, expected))
    throw new ExpectedVersionConflictError(current, expected);
};
