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
  type EventMetaDataOf,
  type TypedProjectionDefinition,
  type DefaultRecord,
  type CanHandle,
} from '@event-driven-io/emmett';
import { type Collection, type WithId } from 'mongodb';
import { v4 as uuid } from 'uuid';

export const MongoDBEventStoreDefaultStreamVersion = 0n;

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  streamId: string;
};

export interface EventStream<
  EventType extends Event = Event,
  ShortInfoType extends DefaultRecord = DefaultRecord,
> {
  streamName: string;
  events: Array<ReadEvent<EventType, ReadEventMetadata>>;
  // TODO: storing metadata,
  metadata: {
    streamId: string;
    streamType: StreamType;
    streamPosition: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  projection: {
    details: { name?: string };
    short: ShortInfoType | null;
  };
}
export type EventStreamEvent<EventType extends Event = Event> =
  EventStream<EventType>['events'][number];

/*
 *  TODO: context for connection
 */
export type MongoDBProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
> = TypedProjectionDefinition<
  EventType,
  EventMetaDataType,
  {
    streamName: StreamName;
    collection: Collection<EventStream>;
  }
>;

export class MongoDBEventStore implements EventStore {
  private readonly collection: Collection<EventStream>;
  private readonly projections?: MongoDBProjectionDefinition[];

  constructor(options: {
    collection: Collection<EventStream>;
    projections?: MongoDBProjectionDefinition[];
  }) {
    this.collection = options.collection;
    this.projections = options.projections;
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions,
  ): Promise<Exclude<ReadStreamResult<EventType>, null>> {
    const expectedStreamVersion = options?.expectedStreamVersion;

    const stream = streamPositionDeserializer(
      await this.collection.findOne<WithId<EventStream<EventType>>>({
        streamName: { $eq: streamName },
      }),
    );

    if (!stream) {
      return {
        events: [],
        currentStreamVersion: MongoDBEventStoreDefaultStreamVersion,
        streamExists: false,
      };
    }

    assertExpectedVersionMatchesCurrent(
      stream.metadata.streamPosition,
      expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    return {
      // TODO: remove `.slice`?
      events: stream.events.slice(0, maxEventIndex(expectedStreamVersion)),
      currentStreamVersion: stream.metadata.streamPosition,
      streamExists: true,
    };
  }

  async aggregateStream<State, EventType extends Event>(
    streamName: StreamName,
    options: AggregateStreamOptions<State, EventType>,
  ): Promise<AggregateStreamResult<State>> {
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
    options?: AppendToStreamOptions,
  ): Promise<AppendToStreamResult> {
    let stream = streamPositionDeserializer(
      await this.collection.findOne({
        streamName: { $eq: streamName },
      }),
    );
    let currentStreamPosition = stream?.metadata?.streamPosition ?? 0n;
    let createdNewStream = false;

    if (!stream) {
      const { streamId, streamType } = fromStreamName(streamName);
      const now = new Date();
      const result = await this.collection.insertOne(
        streamPositionSerializer({
          streamName,
          events: [],
          // TODO:
          metadata: {
            streamId,
            streamType,
            streamPosition: MongoDBEventStoreDefaultStreamVersion,
            createdAt: now,
            updatedAt: now,
          },
          projection: { details: {}, short: null },
        }),
      );
      stream = streamPositionDeserializer(
        await this.collection.findOne({
          _id: result.insertedId,
        }),
      );
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
      stream.metadata.streamPosition,
      options?.expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    if (this.projections) {
      // Pre-commit
      await handleProjections({
        streamName,
        events: eventCreateInputs,
        projections: this.projections,
        collection: this.collection,
      });
    }

    // @ts-expect-error The actual `EventType` is different across each stream document,
    // but the collection was instantiated as being `EventStream<Event>`. Unlike `findOne`,
    // `findOneAndUpdate` does not allow a generic to override what the return type is.
    const updatedStream: WithId<EventStream<EventType>> | null =
      streamPositionDeserializer(
        await this.collection.findOneAndUpdate(
          {
            streamName: { $eq: streamName },
            'metadata.streamPosition': {
              $eq: stream.metadata.streamPosition.toString(),
            },
          },
          {
            $push: { events: { $each: eventCreateInputs } },
            $set: {
              'metadata.updatedAt': new Date(),
              'metadata.streamPosition': (
                stream.metadata.streamPosition + BigInt(events.length)
              ).toString(),
            },
          },
          { returnDocument: 'after' },
        ),
      );

    if (!updatedStream) {
      const currentStream = streamPositionDeserializer(
        await this.collection.findOne({
          streamName: { $eq: streamName },
        }),
      );
      throw new ExpectedVersionConflictError(
        currentStream?.metadata?.streamPosition ?? 0n,
        stream.metadata.streamPosition,
      );
    }

    return {
      nextExpectedStreamVersion: updatedStream.metadata.streamPosition,
      createdNewStream,
    };
  }
}

export const getMongoDBEventStore = (
  options: ConstructorParameters<typeof MongoDBEventStore>[0],
) => {
  const eventStore = new MongoDBEventStore(options);
  return eventStore;
};

async function handleProjections<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadata = EventMetaDataOf<EventType> & ReadEventMetadata,
>(options: {
  streamName: StreamName;
  events: ReadEvent<EventType, EventMetaDataType>[];
  projections: MongoDBProjectionDefinition<EventType>[];
  collection: Collection<EventStream>;
}) {
  const eventTypes = options.events.map((e) => e.type);
  const projections = options.projections.filter((p) =>
    p.canHandle.some((t) => eventTypes.includes(t)),
  );

  for (const { handle } of projections) {
    await handle(options.events, {
      streamName: options.streamName,
      collection: options.collection,
    });
  }
}

export function shortInfoProjection<
  EventType extends Event,
  ShortInfoType extends DefaultRecord,
>(options: {
  name?: string;
  canHandle: CanHandle<EventType>;
  evolve: (state: ShortInfoType, event: EventType) => ShortInfoType;
}): MongoDBProjectionDefinition {
  return {
    name: options.name,
    canHandle: options.canHandle,
    handle: async (events, { streamName, collection }) => {
      const stream = await collection.findOne<
        EventStream<EventType, ShortInfoType>
      >({ streamName });
      // TODO: error handling
      if (!stream) throw new Error();
      const state = events.reduce(
        // @ts-expect-error TS issues
        options.evolve,
        stream.projection.short,
      );
      await collection.updateOne(
        {
          streamName,
          'metadata.streamPosition': stream.metadata.streamPosition,
        },
        {
          $set: {
            'projection.details.name': options.name,
            'projection.short': state,
          },
        },
      );
    },
  };
}

function maxEventIndex(
  expectedStreamVersion?: ExpectedStreamVersion,
): number | undefined {
  if (!expectedStreamVersion) return undefined;

  if (typeof expectedStreamVersion === 'string') {
    switch (expectedStreamVersion) {
      case STREAM_DOES_NOT_EXIST:
        return 0;
      default:
        return undefined;
    }
  }

  // TODO: possibly dangerous for very long event streams. May need to perform DB level
  // selections on the events that we return
  return Number(expectedStreamVersion);
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

/**
 * Converts the `stream.metadata.streamPosition` of the given `stream`
 * to a `string` value to be stored in MongoDB
 */
function streamPositionSerializer<Stream extends EventStream>(
  stream: Stream,
): Stream {
  // @ts-expect-error serializing as a `string`
  stream.metadata.streamPosition = stream.metadata.streamPosition.toString();
  return stream;
}

/**
 * Converts the `stream.metadata.streamPosition` of the given `stream`
 * to a `bigint` value to be used in application
 */
function streamPositionDeserializer<Stream extends EventStream | null>(
  stream: Stream,
): Stream {
  if (!stream) return stream;
  if (typeof stream.metadata.streamPosition === 'bigint') return stream;
  stream.metadata.streamPosition = BigInt(stream.metadata.streamPosition);
  return stream;
}
