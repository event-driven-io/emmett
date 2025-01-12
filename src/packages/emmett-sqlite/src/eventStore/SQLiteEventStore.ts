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
import type { SQLiteConnection } from '../sqliteConnection';
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
};

export const getSQLiteEventStore = (
  db: SQLiteConnection,
  options?: SQLiteEventStoreOptions,
): SQLiteEventStore => {
  let schemaMigrated = false;

  let autoGenerateSchema = false;
  if (options) {
    autoGenerateSchema =
      options.schema?.autoMigration === undefined ||
      options.schema?.autoMigration !== 'None';
  }

  const ensureSchemaExists = async (): Promise<void> => {
    if (!autoGenerateSchema) return Promise.resolve();

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
      const result = await this.readStream<EventType>(streamName, options.read);

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
    > => {
      await ensureSchemaExists();
      return await readStream<EventType>(db, streamName, options);
    },

    appendToStream: async <EventType extends Event>(
      streamName: string,
      events: EventType[],
      options?: AppendToStreamOptions,
    ): Promise<AppendToStreamResult> => {
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
