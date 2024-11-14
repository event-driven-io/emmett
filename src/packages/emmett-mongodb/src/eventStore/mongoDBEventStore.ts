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
  type DefaultRecord,
  type CanHandle,
  type TypedProjectionDefinition,
} from '@event-driven-io/emmett';
import { type Collection, type UpdateFilter, type WithId } from 'mongodb';
import { v4 as uuid } from 'uuid';

export const MongoDBEventStoreDefaultStreamVersion = 0n;

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  streamId: string;
};

export interface EventStreamProjection<
  ShortInfoType extends DefaultRecord = DefaultRecord,
> {
  details: { name?: string };
  short: ShortInfoType | null;
}
export interface EventStream<
  EventType extends Event = Event,
  ShortInfoType extends DefaultRecord = DefaultRecord,
> {
  streamName: string;
  events: Array<ReadEvent<EventType, ReadEventMetadata>>;
  metadata: {
    streamId: string;
    streamType: StreamType;
    streamPosition: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  projections: Record<string, EventStreamProjection<ShortInfoType>>;
}

export type MongoDBProjectionHandlerContext = {
  streamName: StreamName;
  collection: Collection<EventStream>;
};

type MongoDBAsyncProjection<EventType extends Event = Event> = {
  type: 'async';
  projection: TypedProjectionDefinition<EventType>;
};

type MongoDBInlineProjection<
  EventType extends Event = Event,
  ShortInfoType extends DefaultRecord = DefaultRecord,
> = {
  type: 'inline';
  projection: {
    name: string;
    canHandle: CanHandle<EventType>;
    handle: (
      ...args: Parameters<
        TypedProjectionDefinition<
          EventType,
          ReadEventMetadata,
          MongoDBProjectionHandlerContext
        >['handle']
      >
    ) =>
      | Promise<EventStreamProjection<ShortInfoType>>
      | EventStreamProjection<ShortInfoType>;
  };
};

type MongoDBProjection = MongoDBAsyncProjection | MongoDBInlineProjection;

export class MongoDBEventStore implements EventStore {
  private readonly collection: Collection<EventStream>;
  private readonly inlineProjections?: MongoDBInlineProjection[];
  private readonly asyncProjections?: MongoDBAsyncProjection[];

  constructor(options: {
    collection: Collection<EventStream>;
    projections?: MongoDBProjection[];
  }) {
    this.collection = options.collection;
    this.inlineProjections = options.projections?.filter(
      (p) => p.type === 'inline',
    );
    this.asyncProjections = options.projections?.filter(
      (p) => p.type === 'async',
    );
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions,
  ): Promise<Exclude<ReadStreamResult<EventType>, null>> {
    const expectedStreamVersion = options?.expectedStreamVersion;
    const maxIdx = maxEventIndex(expectedStreamVersion);
    const eventsSlice = maxIdx !== undefined ? { $slice: [0, maxIdx] } : 1;

    const stream = await this.collection.findOne<
      WithId<Pick<EventStream<EventType>, 'metadata' | 'events'>>
    >(
      { streamName: { $eq: streamName } },
      {
        useBigInt64: true,
        projection: {
          metadata: 1,
          events: eventsSlice,
        },
      },
    );

    if (!stream) {
      return {
        events: [],
        currentStreamVersion: MongoDBEventStoreDefaultStreamVersion,
        streamExists: false,
      };
    }

    assertExpectedVersionMatchesCurrent(
      BigInt(stream.events.length),
      expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    return {
      events: stream.events,
      // TODO: if returning a slice, do we change this to be the expected stream version?
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
    let stream = await this.collection.findOne(
      { streamName: { $eq: streamName } },
      { useBigInt64: true },
    );
    let currentStreamPosition = stream?.metadata?.streamPosition ?? 0n;
    let createdNewStream = false;

    if (!stream) {
      const { streamId, streamType } = fromStreamName(streamName);
      const now = new Date();
      const result = await this.collection.insertOne({
        streamName,
        events: [],
        metadata: {
          streamId,
          streamType,
          streamPosition: MongoDBEventStoreDefaultStreamVersion,
          createdAt: now,
          updatedAt: now,
        },
        projections: {},
      });
      stream = await this.collection.findOne(
        { _id: result.insertedId },
        { useBigInt64: true },
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

    // TODO: error handling / implement retries
    if (!stream) throw new Error('Failed to create stream');

    assertExpectedVersionMatchesCurrent(
      stream.metadata.streamPosition,
      options?.expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    const updates: UpdateFilter<EventStream> = {
      $push: { events: { $each: eventCreateInputs } },
      $set: {
        'metadata.updatedAt': new Date(),
        'metadata.streamPosition':
          stream.metadata.streamPosition + BigInt(events.length),
      },
    };

    if (this.asyncProjections) {
      // Pre-commit handle async projections
      await handleAsyncProjections({
        streamName,
        events: eventCreateInputs,
        projections: this.asyncProjections,
        collection: this.collection,
      });
    }

    if (this.inlineProjections) {
      const projections = filterProjections(
        this.inlineProjections,
        eventCreateInputs,
      );
      for (const { name, handle } of projections) {
        updates.$set![`projections.${name}`] = await handle(eventCreateInputs, {
          streamName,
          collection: this.collection,
        });
      }
    }

    // @ts-expect-error The actual `EventType` is different across each stream document,
    // but the collection was instantiated as being `EventStream<Event>`. Unlike `findOne`,
    // `findOneAndUpdate` does not allow a generic to override what the return type is.
    const updatedStream: WithId<EventStream<EventType>> | null =
      await this.collection.findOneAndUpdate(
        {
          streamName: { $eq: streamName },
          'metadata.streamPosition': stream.metadata.streamPosition,
        },
        updates,
        { returnDocument: 'after', useBigInt64: true },
      );

    if (!updatedStream) {
      const currentStream = await this.collection.findOne(
        { streamName: { $eq: streamName } },
        { useBigInt64: true },
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

async function handleAsyncProjections<
  EventType extends Event = Event,
>(options: {
  streamName: StreamName;
  events: ReadEvent<EventType, ReadEventMetadata>[];
  projections: MongoDBAsyncProjection[];
  collection: Collection<EventStream>;
}) {
  const projections = filterProjections(options.projections, options.events);
  for (const { handle } of projections) {
    await handle(options.events, {
      streamName: options.streamName,
      collection: options.collection,
    });
  }
}

function filterProjections<
  Projection extends MongoDBAsyncProjection | MongoDBInlineProjection,
>(projections: Projection[], events: ReadEvent[]) {
  const eventTypes = events.map((e) => e.type);
  const filteredProjections = projections
    .map((p) => p.projection)
    .filter((p) => p.canHandle.some((t) => eventTypes.includes(t)));
  return filteredProjections;
}

export function mongoDBInlineProjection<
  EventType extends Event,
  ShortInfoType extends DefaultRecord,
>(options: {
  name: string;
  canHandle: CanHandle<EventType>;
  evolve: (state: ShortInfoType, event: EventType) => ShortInfoType;
}): MongoDBInlineProjection {
  return {
    type: 'inline',
    projection: {
      name: options.name,
      canHandle: options.canHandle,
      handle: async (events, { streamName, collection }) => {
        const stream = await collection.findOne({ streamName });
        const initialState = stream?.projections[options.name] ?? null;
        const state = events.reduce(
          // @ts-expect-error TS issues
          options.evolve,
          initialState,
        );
        return {
          details: { name: options.name },
          short: state,
        };
      },
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

  // TODO: possibly dangerous for very long event streams (overflow)?. May need to perform DB level
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
