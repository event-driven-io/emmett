import { dumbo, type Dumbo } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  assertExpectedVersionMatchesCurrent,
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResultWithGlobalPosition,
  type BeforeEventStoreCommitHandler,
  type Event,
  type EventStore,
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
  AnyEventStoreDriver,
  InferOptionsFromEventStoreDriver,
} from './eventStoreDriver';
import {
  handleProjections,
  type SQLiteProjectionHandlerContext,
} from './projections';
import {
  appendToStream,
  createEventStoreSchema,
  readStream,
  schemaSQL,
  streamExists,
  unknownTag,
  type SQLiteStreamExistsOptions,
} from './schema';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const SQLiteEventStoreDefaultStreamVersion = 0n;

export interface SQLiteEventStore extends EventStore<SQLiteReadEventMetadata> {
  appendToStream<
    EventType extends Event,
    EventPayloadType extends Event = EventType,
  >(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<EventType, EventPayloadType>,
  ): Promise<AppendToStreamResultWithGlobalPosition>;
  consumer<ConsumerEventType extends Event = Event>(
    options?: SQLiteEventStoreConsumerConfig<ConsumerEventType>,
  ): SQLiteEventStoreConsumer<ConsumerEventType>;
  streamExists(
    streamName: string,
    options?: SQLiteStreamExistsOptions,
  ): Promise<StreamExistsResult>;
  close(): Promise<void>;
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

export type SQLiteEventStoreOptions<
  EventStoreDriver extends AnyEventStoreDriver = AnyEventStoreDriver,
> = {
  driver: EventStoreDriver;
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
      connection: AnySQLiteConnection;
    }) => Promise<void> | void;
    /**
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<SQLiteEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      { connection: AnySQLiteConnection }
    >;
    /**
     * This hook will be called **AFTER** event store schema was created
     */
    onAfterSchemaCreated?: () => Promise<void> | void;
  };
} & { pool?: Dumbo } & InferOptionsFromEventStoreDriver<EventStoreDriver>;

export const getSQLiteEventStore = <
  Driver extends AnyEventStoreDriver = AnyEventStoreDriver,
>(
  options: SQLiteEventStoreOptions<Driver>,
): SQLiteEventStore => {
  let autoGenerateSchema = false;

  const pool =
    options.pool ??
    dumbo({
      ...options.driver.mapToDumboOptions(options),
      transactionOptions: {
        allowNestedTransactions: true,
        mode: 'session_based',
      },
    });
  let migrateSchema: Promise<void> | undefined = undefined;

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const onBeforeCommitHook = options.hooks?.onBeforeCommit;

  const withConnection = async <Result>(
    handler: (connection: AnySQLiteConnection) => Promise<Result>,
  ): Promise<Result> =>
    pool.withConnection(async (connection) => {
      await ensureSchemaExists(connection);
      return await handler(connection);
    });

  if (options) {
    autoGenerateSchema =
      options.schema?.autoMigration === undefined ||
      options.schema?.autoMigration !== 'None';
  }

  const migrate = (connection: AnySQLiteConnection): Promise<void> => {
    if (!migrateSchema) {
      migrateSchema = createEventStoreSchema(connection, {
        onBeforeSchemaCreated: async (context) => {
          for (const projection of inlineProjections) {
            if (projection.init) {
              await projection.init({
                version: projection.version ?? 1,
                registrationType: 'async',
                status: 'active',
                context: {
                  execute: context.connection.execute,
                  connection: context.connection,
                  driverType: options.driver.driverType,
                },
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

  const ensureSchemaExists = (
    connection: AnySQLiteConnection,
  ): Promise<void> => {
    if (!autoGenerateSchema) return Promise.resolve();

    return migrate(connection);
  };

  return {
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
      const { evolve, initialState, read } = options;

      const expectedStreamVersion = read?.expectedStreamVersion;

      let state = initialState();

      if (typeof streamName !== 'string') {
        throw new Error('Stream name is not string');
      }

      const result = await withConnection(({ execute }) =>
        readStream<EventType, EventPayloadType>(execute, streamName, read),
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

    readStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      options?: ReadStreamOptions<EventType, EventPayloadType>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > =>
      withConnection(({ execute }) =>
        readStream<EventType, EventPayloadType>(execute, streamName, options),
      ),

    appendToStream: async <
      EventType extends Event,
      EventPayloadType extends Event = EventType,
    >(
      streamName: string,
      events: EventType[],
      appendOptions?: AppendToStreamOptions<EventType, EventPayloadType>,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType = firstPart && rest.length > 0 ? firstPart : unknownTag;

      const appendResult = await withConnection((connection) =>
        appendToStream(connection, streamName, streamType, events, {
          ...(appendOptions as AppendToStreamOptions),
          onBeforeCommit: async (messages, context) => {
            if (inlineProjections.length > 0)
              await handleProjections({
                projections: inlineProjections,
                events: messages,
                execute: context.connection.execute,
                connection: context.connection,
                driverType: options.driver.driverType,
              });

            if (onBeforeCommitHook) await onBeforeCommitHook(messages, context);
          },
        }),
      );

      if (!appendResult.success)
        throw new ExpectedVersionConflictError(
          -1n, //TODO: Return actual version in case of error
          appendOptions?.expectedStreamVersion ?? NO_CONCURRENCY_CHECK,
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
      return withConnection(({ execute }) =>
        streamExists(execute, streamName, options),
      );
    },

    consumer: <ConsumerEventType extends Event = Event>(
      consumerOptions?: SQLiteEventStoreConsumerConfig<ConsumerEventType>,
    ): SQLiteEventStoreConsumer<ConsumerEventType> =>
      sqliteEventStoreConsumer<ConsumerEventType, Driver>({
        ...(options ?? {}),
        ...(consumerOptions ?? {}),
        pool,
      }),

    close: () => pool.close(),
    schema: {
      sql: () => schemaSQL.join(''),
      print: () => console.log(schemaSQL.join('')),
      migrate: () => pool.withConnection(migrate),
    },
  };
};
