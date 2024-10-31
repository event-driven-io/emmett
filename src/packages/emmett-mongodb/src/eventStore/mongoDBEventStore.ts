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
import { type Collection, MongoClient, type WithId } from 'mongodb';
import { v4 as uuid } from 'uuid';

export const MongoDBEventStoreDefaultStreamVersion = -1;
export const MongoDBDefaultCollectionName = 'eventstreams';

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  streamId: string;
};

export type StreamToProject<EventType extends Event> = {
  streamName: StreamName;
  streamType: StreamType;
  streamId: string;
  streamVersion: number;
  events: ReadEvent<EventType, ReadEventMetadata>[];
};

export type Projection<EventType extends Event> = (
  stream: StreamToProject<EventType>,
) => void | Promise<void>;

export interface EventStream<EventType extends Event> {
  streamName: string;
  events: Array<ReadEvent<EventType, ReadEventMetadata>>;
  createdAt: Date;
  updatedAt: Date;
}
export type EventStreamEvent<EventType extends Event> =
  EventStream<EventType>['events'][number];

export interface MongoDBConnectionOptions {
  connectionString: string;
  database: string;
  collection?: string;
}

class EventStoreClass implements EventStore<number> {
  private readonly collection: Collection<EventStream<Event>>;

  constructor(collection: typeof this.collection) {
    this.collection = collection;
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions<number>,
  ): Promise<Exclude<ReadStreamResult<EventType, number>, null>> {
    const expectedStreamVersion = options?.expectedStreamVersion;

    const stream = await this.collection.findOne<
      WithId<EventStream<EventType>>
    >({
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

    return {
      events: stream.events.slice(0, maxEventIndex(expectedStreamVersion)),
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
      projections?: Array<Projection<EventType>>;
    },
  ): Promise<AppendToStreamResult<number>> {
    let stream = await this.collection.findOne({
      streamName: { $eq: streamName },
    });
    let currentStreamPosition = stream?.events.length ?? 0;
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

    const eventCreateInputs: ReadEvent[] = [];
    for (const event of events) {
      currentStreamPosition++;
      eventCreateInputs.push({
        type: event.type,
        data: event.data,
        metadata: {
          now: new Date(),
          eventId: uuid(),
          streamName,
          streamPosition: BigInt(currentStreamPosition),
          ...(event.metadata ?? {}),
        },
      });
    }

    // TODO: better error here, should rarely happen if ever
    // if another error was not thrown before this
    if (!stream) throw new Error('Failed to create stream');

    assertExpectedVersionMatchesCurrent(
      stream.events.length,
      options?.expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    // @ts-expect-error The actual `EventType` is different across each stream document,
    // but the collection was instantiated as being `EventStream<Event>`. Unlike `findOne`,
    // `findOneAndUpdate` does not allow a generic to override what the return type is.
    const updatedStream: WithId<EventStream<EventType>> | null =
      await this.collection.findOneAndUpdate(
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

    const { streamType, streamId } = fromStreamName(streamName);

    await executeProjections(
      {
        streamName,
        streamType,
        streamId,
        streamVersion: updatedStream.events.length,
        events: updatedStream.events,
      },
      options?.projections,
    );

    return {
      nextExpectedStreamVersion: updatedStream.events.length,
      createdNewStream,
    };
  }
}

export const getMongoDBEventStore = async (
  options: MongoDBConnectionOptions,
) => {
  const client = new MongoClient(options.connectionString);
  const db = client.db(options.database);
  const collection = db.collection<EventStream<Event>>(
    options.collection ?? MongoDBDefaultCollectionName,
  );
  await collection.createIndex({ streamName: 1 }, { unique: true });
  const eventStore = new EventStoreClass(collection);
  return eventStore;
};

function executeProjections<EventType extends Event>(
  params: StreamToProject<EventType>,
  projections?: Array<Projection<EventType>>,
) {
  return Promise.all((projections ?? []).map((project) => project(params)));
}

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
 * Accepts a `streamType` (the type/category of the event stream) and an `streamId`
 * (the individual entity/object or aggregate ID) and combines them to a singular
 * `streamName` which can be used in `EventStore`.
 */
export function toStreamName<T extends StreamType>(
  streamType: T,
  streamId: string,
): StreamName<T> {
  return `${streamType}:${streamId}`;
}

/**
 * Accepts a fully formatted `streamName` and returns the broken down
 * `streamType` and `streamId`.
 */
export function fromStreamName<T extends StreamType>(
  streamName: StreamName<T>,
): StreamNameParts<T> {
  const parts = streamName.split(':') as [T, string];
  return {
    streamType: parts[0],
    streamId: parts[1],
  };
}
