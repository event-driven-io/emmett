import type {
  AppendToStreamResultWithGlobalPosition,
  BeforeEventStoreCommitHandler,
  BigIntStreamPosition,
  Event,
  ProjectionRegistration,
  ReadEvent,
  ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';

import {
  assertExpectedVersionMatchesCurrent,
  ExpectedVersionConflictError,
  NO_CONCURRENCY_CHECK,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import {
  InMemorySQLiteDatabase,
  sqliteConnection,
  type SQLiteConnection,
} from '../connection';
import {
  handleProjections,
  type SQLiteProjectionHandlerContext,
} from './projections';
import { createEventStoreSchema } from './schema';
import { appendToStream } from './schema/appendToStream';
import { readStream } from './schema/readStream';

export type EventHandler<E extends Event = Event> = (
  eventEnvelope: ReadEvent<E>,
) => void;

export const SQLiteEventStoreDefaultStreamVersion = 0n;

export type SQLiteEventStore = EventStore<SQLiteReadEventMetadata>;

export type SQLiteReadEventMetadata = ReadEventMetadataWithGlobalPosition;

export type SQLiteReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  SQLiteReadEventMetadata
>;

export type SQLiteEventStoreOptions = {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  fileName: InMemorySQLiteDatabase | string | undefined;
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
     * This hook will be called **BEFORE** events were stored in the event store.
     * @type {BeforeEventStoreCommitHandler<SQLiteEventStore, HandlerContext>}
     */
    onBeforeCommit?: BeforeEventStoreCommitHandler<
      SQLiteEventStore,
      { connection: SQLiteConnection }
    >;
  };
};

export const getSQLiteEventStore = (
  options: SQLiteEventStoreOptions,
): SQLiteEventStore => {
  let schemaMigrated = false;
  let autoGenerateSchema = false;
  let database: SQLiteConnection | null;
  const fileName = options.fileName ?? InMemorySQLiteDatabase;

  const isInMemory: boolean = fileName === InMemorySQLiteDatabase;

  const inlineProjections = (options.projections ?? [])
    .filter(({ type }) => type === 'inline')
    .map(({ projection }) => projection);

  const onBeforeCommitHook = options.hooks?.onBeforeCommit;

  const createConnection = () => {
    if (database != null) {
      return database;
    }

    return sqliteConnection({
      fileName,
    });
  };

  const closeConnection = () => {
    if (isInMemory) {
      return;
    }
    if (database != null) {
      database.close();
      database = null;
    }
  };

  const withConnection = async <Result>(
    handler: (db: SQLiteConnection) => Promise<Result>,
  ): Promise<Result> => {
    if (database == null) {
      database = createConnection();
    }

    try {
      await ensureSchemaExists(database);
      return await handler(database);
    } finally {
      closeConnection();
    }
  };

  if (options) {
    autoGenerateSchema =
      options.schema?.autoMigration === undefined ||
      options.schema?.autoMigration !== 'None';
  }

  const ensureSchemaExists = async (
    connection: SQLiteConnection,
  ): Promise<void> => {
    if (!autoGenerateSchema) return Promise.resolve();

    if (!schemaMigrated) {
      await createEventStoreSchema(connection);
      schemaMigrated = true;
    }

    return Promise.resolve();
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

      if (database == null) {
        database = createConnection();
      }

      const result = await withConnection((db) =>
        readStream<EventType>(db, streamName, options.read),
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
      options?: ReadStreamOptions<BigIntStreamPosition>,
    ): Promise<
      ReadStreamResult<EventType, ReadEventMetadataWithGlobalPosition>
    > => withConnection((db) => readStream<EventType>(db, streamName, options)),

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResultWithGlobalPosition> => {
      if (database == null) {
        database = createConnection();
      }

      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType =
        firstPart && rest.length > 0 ? firstPart : 'emt:unknown';

      const appendResult = await withConnection((db) =>
        appendToStream(db, streamName, streamType, events, {
          ...options,
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
  };
};
