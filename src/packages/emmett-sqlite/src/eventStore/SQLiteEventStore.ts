import {
  assertExpectedVersionMatchesCurrent,
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type BeforeEventStoreCommitHandler,
  type BigIntStreamPosition,
  type Event,
  type EventStore,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type StreamExistsResult,
} from '@event-driven-io/emmett';
import { InMemorySQLiteDatabase, type SQLiteConnection } from '../connection';
import {
  SQLiteConnectionPool,
  type SQLiteConnectionPoolOptions,
} from '../connection/sqliteConnectionPool';
import {
  sqliteEventStoreConsumer,
  type SQLiteEventStoreConsumer,
  type SQLiteEventStoreConsumerConfig,
} from './consumers';
import {
  handleProjections,
  type SQLiteProjectionHandlerContext,
} from './projections';
import { createEventStoreSchema, schemaSQL, unknownTag } from './schema';
import { appendToStream } from './schema/appendToStream';
import { readStream } from './schema/readStream';
import {
  streamExists,
  type SQLiteStreamExistsOptions,
} from './schema/streamExists';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const SQLiteEventStoreDefaultStreamVersion = 0n;

export interface SQLiteEventStore extends EventStore<SQLiteReadEventMetadata> {
  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<bigint, EventType>,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerEventType extends Event = Event>(
    options?: SQLiteEventStoreConsumerConfig<ConsumerEventType>,
  ): SQLiteEventStoreConsumer<ConsumerEventType>;
  streamExists(
    streamName: string,
    options?: SQLiteStreamExistsOptions,
  ): Promise<StreamExistsResult>;
  schema: {
    sql(): string;
    print(): void;
    migrate(): Promise<void>;
  };
}

export type SQLiteReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type SQLiteReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  SQLiteReadEventMetadata
>;

export type SQLiteEventStoreConnectionOptions = {
  connection: SQLiteConnection;
};

export type SQLiteEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext
  >[];
  schema?: {
    autoMigration?: 'None' | 'CreateOrUpdate';
  };
  hooks?: {
    /**
     * This hook will be called **BEFORE** event store schema is created
     */
    onBeforeSchemaCreated?: (context: {
      connection: SQLiteConnection;
    }) => Promise<void> | void;
    /**
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<SQLiteEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      { connection: SQLiteConnection }
    >;
    /**
     * This hook will be called **AFTER** event store schema was created
     */
    onAfterSchemaCreated?: () => Promise<void> | void;
  };
} & SQLiteConnectionPoolOptions & { pool?: SQLiteConnectionPool };

export const getSQLiteEventStore = (
  options: SQLiteEventStoreOptions,
): SQLiteEventStore => {
  let autoGenerateSchema = false;
  const fileName = options.fileName ?? InMemorySQLiteDatabase;
  const pool = options.pool ?? SQLiteConnectionPool(options);
  let migrateSchema: Promise<void> | undefined = undefined;

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const onBeforeCommitHook = options.hooks?.onBeforeCommit;

  const withConnection = async <Result>(
    handler: (connection: SQLiteConnection) => Promise<Result>,
  ): Promise<Result> =>
    pool.withConnection(async (database) => {
      await ensureSchemaExists(database);
      return await handler(database);
    });

  if (options) {
    autoGenerateSchema =
      options.schema?.autoMigration === undefined ||
      options.schema?.autoMigration !== 'None';
  }

  const migrate = (connection: SQLiteConnection): Promise<void> => {
    if (!migrateSchema) {
      migrateSchema = createEventStoreSchema(connection, {
        onBeforeSchemaCreated: async (context) => {
          for (const projection of inlineProjections) {
            if (projection.init) {
              await projection.init({
                version: projection.version ?? 1,
                registrationType: 'async',
                status: 'active',
                context,
              });
            }
          }
          if (options.hooks?.onBeforeSchemaCreated) {
            await options.hooks.onBeforeSchemaCreated(context);
          }
        },
        onAfterSchemaCreated: options.hooks?.onAfterSchemaCreated,
      });
    }

    return migrateSchema;
  };

  const ensureSchemaExists = (connection: SQLiteConnection): Promise<void> => {
    if (!autoGenerateSchema) return Promise.resolve();

    return migrate(connection);
  };

  return {
    async aggregateStream<State, EventType extends Event>(
      streamName: string,
      options: AggregateStreamOptions<
        State,
        EventType,
        ReadEventMetadataWithGlobalPosition
      >,
    ): Promise<AggregateStreamResult<State>> {
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();

      if (typeof streamName !== 'string') {
        throw new Error('Stream name is not string');
      }

      const result = await withConnection((connection) =>
        readStream<EventType>(connection, streamName, read),
      );

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

    readStream: async <EventType extends Event>(
      streamName: string,
      options?: ReadStreamOptions<BigIntStreamPosition, EventType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > =>
      withConnection((connection) =>
        readStream<EventType>(connection, streamName, options),
      ),

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions<bigint, EventType>,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType = firstPart && rest.length > 0 ? firstPart : unknownTag;

      const downcast = options?.schema?.versioning?.downcast;
      const eventsToStore = downcast ? events.map(downcast) : events;

      const appendResult = await withConnection((connection) =>
        appendToStream(connection, streamName, streamType, eventsToStore, {
          expectedStreamVersion: options?.expectedStreamVersion,
          onBeforeCommit: async (messages, context) => {
            if (inlineProjections.length > 0)
              await handleProjections({
                projections: inlineProjections,
                events: messages,
                ...context,
              });

            if (onBeforeCommitHook) await onBeforeCommitHook(messages, context);
          },
        }),
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

    streamExists(
      streamName: string,
      options?: SQLiteStreamExistsOptions,
    ): Promise<StreamExistsResult> {
      return withConnection((connection) =>
        streamExists(connection, streamName, options),
      );
    },

    consumer: <ConsumerEventType extends Event = Event>(
      options?: SQLiteEventStoreConsumerConfig<ConsumerEventType>,
    ): SQLiteEventStoreConsumer<ConsumerEventType> =>
      sqliteEventStoreConsumer<ConsumerEventType>({
        ...(options ?? {}),
        fileName,
        pool,
      }),

    schema: {
      sql: () => schemaSQL.join(''),
      print: () => console.log(schemaSQL.join('')),
      migrate: () => pool.withConnection(migrate),
    },
  };
};
