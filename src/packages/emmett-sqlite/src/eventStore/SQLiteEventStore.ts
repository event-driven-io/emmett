import type {
  BigIntStreamPosition,
  Event,
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
  type AppendToStreamResult,
  type EventStore,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import {
  sqliteConnection,
  type AbsolutePath,
  type RelativePath,
  type SQLiteConnection,
} from '../sqliteConnection';
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
  schema?: {
    autoMigration?: 'None' | 'CreateOrUpdate';
  };
  shouldManageClientLifetime?: boolean;
  databaseLocation: AbsolutePath | RelativePath | ':memory:';
};

export const getSQLiteEventStore = (
  options: SQLiteEventStoreOptions,
): SQLiteEventStore => {
  let schemaMigrated = false;
  let autoGenerateSchema = false;
  let db: SQLiteConnection | null;
  const databaseLocation = options.databaseLocation ?? null;

  const isInMemory: boolean = databaseLocation === ':memory:';

  const createConnection = () => {
    if (db != null) {
      return db;
    }

    return sqliteConnection({
      location: databaseLocation,
    });
  };

  const closeConnection = () => {
    if (isInMemory) {
      return;
    }
    if (db != null) {
      db.close();
      db = null;
    }
  };

  if (options) {
    autoGenerateSchema =
      options.schema?.autoMigration === undefined ||
      options.schema?.autoMigration !== 'None';
  }

  const ensureSchemaExists = async (): Promise<void> => {
    if (!autoGenerateSchema) return Promise.resolve();
    if (db == null) {
      throw new Error('Database connection does not exist');
    }
    if (!schemaMigrated) {
      await createEventStoreSchema(db);
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
        throw new Error('not string');
      }

      if (db == null) {
        db = createConnection();
      }

      const result = await readStream<EventType>(db, streamName, options.read);

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

      closeConnection();

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
    > => {
      if (db == null) {
        db = createConnection();
      }

      await ensureSchemaExists();
      const stream = await readStream<EventType>(db, streamName, options);

      closeConnection();
      return stream;
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
      if (db == null) {
        db = createConnection();
      }

      await ensureSchemaExists();
      // TODO: This has to be smarter when we introduce urn-based resolution
      const [firstPart, ...rest] = streamName.split('-');

      const streamType =
        firstPart && rest.length > 0 ? firstPart : 'emt:unknown';

      const appendResult = await appendToStream(
        db,
        streamName,
        streamType,
        events,
        options,
      );

      closeConnection();

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
