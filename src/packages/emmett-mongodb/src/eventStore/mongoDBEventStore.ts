import {
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  assertExpectedVersionMatchesCurrent,
  type EventStore,
  type Event,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type ReadStreamOptions,
  type ReadStreamResult,
  type ReadEvent,
  type ReadEventMetadata,
  type ExpectedStreamVersion,
} from '@event-driven-io/emmett';
import { type Collection, MongoClient, ObjectId } from 'mongodb';

export const MongoDBEventStoreDefaultStreamVersion = -1;
export const MongoDBDefaultCollectionName = 'eventstreams';

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  entityId: string;
};

export type StreamToProject<EventType extends Event> = {
  streamName: StreamName;
  streamType: StreamType;
  entityId: string;
  streamVersion: number;
  events: EventType[];
};

export interface EventStream {
  streamName: string;
  events: Array<{
    _id: ObjectId;
    type: string;
    data: string;
    metadata: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
export type EventStreamEvent = EventStream['events'][number];

export interface MongoDBConnectionOptions {
  connectionString: string;
  database: string;
  collection?: string;
}

class EventStoreClass implements EventStore<number> {
  private readonly collection: Collection<EventStream>;

  constructor(collection: typeof this.collection) {
    this.collection = collection;
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions<number>,
  ): Promise<Exclude<ReadStreamResult<EventType, number>, null>> {
    const expectedStreamVersion = options?.expectedStreamVersion;
    const stream = await this.collection.findOne({
      streamName: { $eq: streamName },
    });

    if (!stream) {
      return {
        events: [],
        currentStreamVersion: MongoDBEventStoreDefaultStreamVersion,
        streamExists: false,
      };
    }

    assertExpectedVersionMatchesCurrent(
      stream.events.length,
      expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    const formattedEvents = stream.events
      .slice(0, maxEventIndex(expectedStreamVersion))
      .map(this.parseEvent<EventType>(streamName));

    return {
      events: formattedEvents,
      currentStreamVersion: stream.events.length,
      streamExists: true,
    };
  }

  async aggregateStream<State, EventType extends Event>(
    streamName: StreamName,
    options: AggregateStreamOptions<State, EventType, number>,
  ): Promise<AggregateStreamResult<State, number>> {
    const stream = await this.readStream<EventType>(streamName, options?.read);
    const state = stream.events.reduce(options.evolve, options.initialState());
    return {
      state,
      currentStreamVersion: stream.currentStreamVersion,
      streamExists: stream.streamExists,
    };
  }

  async appendToStream<EventType extends Event>(
    streamName: StreamName,
    events: EventType[],
    options?: AppendToStreamOptions<number> & {
      /**
       * These will be ran after a the events have been successfully appended to
       * the stream. `appendToStream` will return after every projection is completed.
       */
      projections?: Array<
        (stream: StreamToProject<EventType>) => void | Promise<void>
      >;
      /**
       * Same as `options.projections` but this will run asynchronously.
       */
      asyncProjections?: Array<
        (stream: StreamToProject<EventType>) => void | Promise<void>
      >;
    },
  ): Promise<AppendToStreamResult<number>> {
    const eventCreateInputs = events.map(this.stringifyEvent);

    let stream = await this.collection.findOne({
      streamName: { $eq: streamName },
    });
    let createdNewStream = false;

    if (!stream) {
      const result = await this.collection.insertOne({
        streamName,
        events: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      stream = await this.collection.findOne({
        _id: result.insertedId,
      });
      createdNewStream = true;
    }

    // TODO: better error here, should rarely happen if ever
    // if another error was not thrown before this
    if (!stream) throw new Error('Failed to create stream');

    assertExpectedVersionMatchesCurrent(
      stream.events.length,
      options?.expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    const updatedStream = await this.collection.findOneAndUpdate(
      {
        streamName: { $eq: streamName },
        events: { $size: stream.events.length },
        updatedAt: new Date(),
      },
      { $push: { events: { $each: eventCreateInputs } } },
      { returnDocument: 'after' },
    );

    if (!updatedStream) {
      const currentStream = await this.collection.findOne({
        streamName: { $eq: streamName },
      });
      throw new ExpectedVersionConflictError(
        currentStream?.events.length ?? -1,
        stream.events.length,
      );
    }

    const { streamType, entityId } = fromStreamName(streamName);

    if (options?.projections) {
      await Promise.all(
        options.projections.map((project) =>
          project({
            streamName,
            streamType,
            entityId,
            streamVersion: updatedStream.events.length,
            events: updatedStream.events.map(this.parseEvent(streamName)),
          }),
        ),
      );
    }

    if (options?.asyncProjections) {
      for (const project of options.asyncProjections) {
        project({
          streamName,
          streamType,
          entityId,
          streamVersion: updatedStream.events.length,
          events: updatedStream.events.map(this.parseEvent(streamName)),
        });
      }
    }

    return {
      nextExpectedStreamVersion: updatedStream.events.length,
      createdNewStream,
    };
  }

  /**
   * Transforms the `event` from the saved format into the usable object
   * at runtime. This function may be altered later to match `stringifyEvent`.
   */
  private parseEvent<EventType extends Event>(streamName: StreamName) {
    return (
      event: EventStreamEvent,
      index?: number,
    ): ReadEvent<EventType, ReadEventMetadata> => {
      const metadata = {
        ...JSON.parse(event.metadata),
        eventId: event._id,
        streamName,
        streamPosition: BigInt(index ?? 0),
      } satisfies ReadEventMetadata;

      // TODO: is this correct?
      // @ts-expect-error
      return {
        __brand: 'Event',
        type: event.type,
        data: JSON.parse(event.data),
        metadata,
      };
    };
  }

  /**
   * Transforms the `event` into a saveable format. This function may
   * be altered later depending on storage needs.
   */
  private stringifyEvent<EventType extends Event>(
    event: EventType,
  ): EventStreamEvent {
    return {
      _id: new ObjectId(),
      type: event.type,
      data: JSON.stringify(event.data),
      metadata: JSON.stringify(
        event.metadata ?? {
          now: new Date(),
        },
      ),
    };
  }
}

export const getMongoDBEventStore = async (
  options: MongoDBConnectionOptions,
) => {
  const client = new MongoClient(options.connectionString);
  const db = client.db(options.database);
  const collection = db.collection<EventStream>(
    options.collection ?? MongoDBDefaultCollectionName,
  );
  await collection.createIndex({ streamName: 1 }, { unique: true });
  const eventStore = new EventStoreClass(collection);
  return eventStore;
};

function maxEventIndex(
  expectedStreamVersion?: ExpectedStreamVersion<number>,
): number | undefined {
  if (!expectedStreamVersion) return undefined;

  if (typeof expectedStreamVersion === 'number') {
    return expectedStreamVersion;
  }

  switch (expectedStreamVersion) {
    case STREAM_DOES_NOT_EXIST:
      return 0;
    default:
      return undefined;
  }
}

/**
 * Accepts a `streamType` (the type/category of the event stream) and an `entityId`
 * (the individual entity/object or aggregate ID) and combines them to a singular
 * `streamName` which can be used in `EventStore`.
 */
export function toStreamName<T extends StreamType>(
  streamType: T,
  entityId: string,
): StreamName<T> {
  return `${streamType}:${entityId}`;
}

/**
 * Accepts a fully formatted `streamName` and returns the broken down
 * `streamType` and `entityId`.
 */
export function fromStreamName<T extends StreamType>(
  streamName: StreamName<T>,
): StreamNameParts<T> {
  const parts = streamName.split(':') as [T, string];
  return {
    streamType: parts[0],
    entityId: parts[1],
  };
}
