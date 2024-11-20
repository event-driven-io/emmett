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

export interface EventStreamProjection {
  details: { name?: string };
  short: DefaultRecord | null;
}
export interface EventStream<EventType extends Event = Event> {
  streamName: string;
  events: Array<ReadEvent<EventType, ReadEventMetadata>>;
  metadata: {
    streamId: string;
    streamType: StreamType;
    streamPosition: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  projections: Record<string, EventStreamProjection>;
}

export type MongoDBProjectionHandlerContext = {
  streamName: StreamName;
  collection: Collection<EventStream>;
};

type MongoDBAsyncProjection<EventType extends Event = Event> = {
  type: 'async';
  projection: TypedProjectionDefinition<EventType>;
};

type MongoDBInlineProjection<EventType extends Event = Event> = {
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
    ) => Promise<EventStreamProjection> | EventStreamProjection;
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
    // TODO: use `to` and `from`

    const filter = {
      streamName: { $eq: streamName },
    };

    const eventsSliceArr: number[] = [];

    if (options && 'from' in options) {
      eventsSliceArr.push(Number(options.from));
    } else {
      eventsSliceArr.push(0);
    }

    if (options && 'to' in options) {
      eventsSliceArr.push(Number(options.to));
    }

    const eventsSlice =
      eventsSliceArr.length > 1 ? { $slice: eventsSliceArr } : 1;

    const stream = await this.collection.findOne<
      WithId<Pick<EventStream<EventType>, 'metadata' | 'events'>>
    >(filter, {
      useBigInt64: true,
      projection: {
        metadata: 1,
        events: eventsSlice,
      },
    });

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
      events: stream.events,
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
    const eventCreateInputs: ReadEvent[] = [];
    for (const event of events) {
      eventCreateInputs.push({
        type: event.type,
        data: event.data,
        metadata: {
          now: new Date(),
          eventId: uuid(),
          streamName,
          streamPosition: MongoDBEventStoreDefaultStreamVersion, // TODO: don't think we can update this unless we read stream first
          ...(event.metadata ?? {}),
        },
      });
    }

    const updates: UpdateFilter<EventStream> = {
      $push: { events: { $each: eventCreateInputs } },
      $set: { 'metadata.updatedAt': new Date() },
      $inc: { 'metadata.streamPosition': BigInt(events.length) },
    };

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

    // TODO: determine if stream was upserted for `createdNewStream`
    // Can be done with `updateOne` instead, but then we lose the current stream version because the
    // document itself isn't returned. Would require a read after update.
    const updatedStream = await this.collection.findOneAndUpdate(
      {
        streamName: { $eq: streamName },
        'metadata.streamPosition': toExpectedVersion(
          options?.expectedStreamVersion,
        ),
      },
      updates,
      { returnDocument: 'after', useBigInt64: true, upsert: true },
    );

    if (!updatedStream) {
      const currentStream = await this.collection.findOne(
        { streamName: { $eq: streamName } },
        { useBigInt64: true },
      );
      throw new ExpectedVersionConflictError(
        currentStream?.metadata?.streamPosition ?? 0n,
        options?.expectedStreamVersion ?? 0n,
      );
    }

    if (this.asyncProjections) {
      // Pre-commit handle async projections
      await handleAsyncProjections({
        streamName,
        events: eventCreateInputs,
        projections: this.asyncProjections,
        collection: this.collection,
      });
    }

    return {
      nextExpectedStreamVersion: updatedStream.metadata.streamPosition,
      createdNewStream: false, // TODO:
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

function toExpectedVersion(
  expectedStreamVersion?: ExpectedStreamVersion,
): bigint | undefined {
  if (!expectedStreamVersion) return undefined;

  if (typeof expectedStreamVersion === 'string') {
    switch (expectedStreamVersion) {
      case STREAM_DOES_NOT_EXIST:
        return BigInt(0);
      default:
        return undefined;
    }
  }

  // TODO: possibly dangerous for very long event streams (overflow)?. May need to perform DB level
  // selections on the events that we return
  return expectedStreamVersion;
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
