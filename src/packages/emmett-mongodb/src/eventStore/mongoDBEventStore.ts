import {
  ExpectedVersionConflictError,
  STREAM_DOES_NOT_EXIST,
  assertExpectedVersionMatchesCurrent,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type Event,
  type EventMetaDataOf,
  type EventStore,
  type ExpectedStreamVersion,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithoutGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
} from '@event-driven-io/emmett';
import {
  type Collection,
  type Document,
  type UpdateFilter,
  type WithId,
} from 'mongodb';
import { v4 as uuid } from 'uuid';
import {
  handleInlineProjections,
  type MongoDBInlineProjectionDefinition,
  type MongoDBProjectionInlineHandlerContext,
} from './projections';

export const MongoDBEventStoreDefaultStreamVersion = 0n;

export type StreamType = string;
export type StreamName<T extends StreamType = StreamType> = `${T}:${string}`;

export type StreamNameParts<T extends StreamType = StreamType> = {
  streamType: T;
  streamId: string;
};

export type MongoDBReadModel<Doc extends Document = Document> = Doc & {
  _metadata: {
    name: string;
    streamPosition: bigint;
  };
};

export interface EventStream<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    MongoDBReadEventMetadata = EventMetaDataOf<EventType> &
    MongoDBReadEventMetadata,
> {
  streamName: string;
  events: Array<ReadEvent<EventType, EventMetaDataType>>;
  metadata: {
    streamId: string;
    streamType: StreamType;
    streamPosition: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  projections: Record<string, MongoDBReadModel>;
}

export interface MongoDBConnectionOptions {
  connectionString: string;
  database: string;
  collection?: string;
}

export type MongoDBReadEventMetadata =
  ReadEventMetadataWithoutGlobalPosition<bigint>;

export type MongoDBReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  MongoDBReadEventMetadata
>;

export type MongoDBEventStoreOptions = {
  collection: Collection<EventStream>;
  projections?: ProjectionRegistration<
    'inline',
    MongoDBReadEventMetadata,
    MongoDBProjectionInlineHandlerContext
  >[];
};

export class MongoDBEventStore implements EventStore<MongoDBReadEventMetadata> {
  private readonly collection: Collection<EventStream>;
  private readonly inlineProjections: MongoDBInlineProjectionDefinition[];

  constructor(options: MongoDBEventStoreOptions) {
    this.collection = options.collection;
    this.inlineProjections = (options.projections ?? [])
      .filter(({ type }) => type === 'inline')
      .map(
        ({ projection }) => projection,
      ) as MongoDBInlineProjectionDefinition[];
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions,
  ): Promise<
    Exclude<ReadStreamResult<EventType, MongoDBReadEventMetadata>, null>
  > {
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
    options: AggregateStreamOptions<State, EventType, MongoDBReadEventMetadata>,
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
    const expectedStreamVersion = options?.expectedStreamVersion;

    const stream = await this.collection.findOne<
      WithId<Pick<EventStream<EventType>, 'metadata' | 'projections'>>
    >(
      { streamName: { $eq: streamName } },
      {
        useBigInt64: true,
        projection: {
          'metadata.streamPosition': 1,
          projections: 1,
        },
      },
    );

    const currentStreamVersion =
      stream?.metadata.streamPosition ?? MongoDBEventStoreDefaultStreamVersion;

    assertExpectedVersionMatchesCurrent(
      currentStreamVersion,
      expectedStreamVersion,
      MongoDBEventStoreDefaultStreamVersion,
    );

    let streamOffset = currentStreamVersion;

    const eventCreateInputs: ReadEvent<
      EventType,
      EventMetaDataOf<EventType> & MongoDBReadEventMetadata
    >[] = events.map((event) => {
      const metadata: MongoDBReadEventMetadata = {
        eventId: uuid(),
        streamName,
        streamPosition: ++streamOffset,
      };
      return {
        type: event.type,
        data: event.data,
        metadata: {
          ...metadata,
          ...(event.metadata ?? {}),
        },
      } as ReadEvent<
        EventType,
        EventMetaDataOf<EventType> & MongoDBReadEventMetadata
      >;
    });

    const updates: UpdateFilter<EventStream> = {
      $push: { events: { $each: eventCreateInputs } },
      $set: { 'metadata.updatedAt': new Date() },
      $inc: { 'metadata.streamPosition': BigInt(events.length) },
    };

    if (this.inlineProjections) {
      await handleInlineProjections({
        readModels: stream?.projections ?? {},
        events: eventCreateInputs,
        projections: this.inlineProjections,
        collection: this.collection,
        updates,
        client: {},
      });
    }

    const updatedStream = await this.collection.updateOne(
      {
        streamName: { $eq: streamName },
        'metadata.streamPosition': toExpectedVersion(
          options?.expectedStreamVersion,
        ),
      },
      updates,
      { useBigInt64: true, upsert: true },
    );

    if (!updatedStream) {
      throw new ExpectedVersionConflictError(
        currentStreamVersion,
        options?.expectedStreamVersion ?? 0n,
      );
    }

    // if (this.asyncProjections) {
    //   // Pre-commit handle async projections
    //   await handleAsyncProjections({
    //     streamName,
    //     events: eventCreateInputs,
    //     projections: this.asyncProjections,
    //     collection: this.collection,
    //   });
    // }

    return {
      nextExpectedStreamVersion:
        currentStreamVersion + BigInt(eventCreateInputs.length),
      createdNewStream:
        currentStreamVersion === MongoDBEventStoreDefaultStreamVersion,
    };
  }
}

export const getMongoDBEventStore = (
  options: ConstructorParameters<typeof MongoDBEventStore>[0],
) => {
  const eventStore = new MongoDBEventStore(options);
  return eventStore;
};

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
