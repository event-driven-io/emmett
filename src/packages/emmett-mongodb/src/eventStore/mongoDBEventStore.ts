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
  Db,
  MongoClient,
  type Collection,
  type Document,
  type MongoClientOptions,
  type Filter,
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

export type StreamCollectionName<T extends StreamType = StreamType> =
  `emt:${T}`;

export type StreamCollectionNameParts<T extends StreamType = StreamType> = {
  streamType: T;
};

export type MongoDBReadModelMetadata = {
  name: string;
  schemaVersion: number;
  streamPosition: bigint;
};

export type MongoDBReadModel<Doc extends Document = Document> = Doc & {
  _metadata: MongoDBReadModelMetadata;
};

export interface EventStream<
  EventType extends Event = Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    MongoDBReadEventMetadata = EventMetaDataOf<EventType> &
    MongoDBReadEventMetadata,
> {
  streamName: string;
  messages: Array<ReadEvent<EventType, EventMetaDataType>>;
  metadata: {
    streamId: string;
    streamType: StreamType;
    streamPosition: bigint;
    createdAt: Date;
    updatedAt: Date;
  };
  projections: Record<string, MongoDBReadModel>;
}

export type MongoDBReadEventMetadata =
  ReadEventMetadataWithoutGlobalPosition<bigint>;

export type MongoDBReadEvent<EventType extends Event = Event> = ReadEvent<
  EventType,
  MongoDBReadEventMetadata
>;

export type MongoDBEventStoreOptions = {
  database?: string;
  collection?: string;
  projections?: ProjectionRegistration<
    'inline',
    MongoDBReadEventMetadata,
    MongoDBProjectionInlineHandlerContext
  >[];
} & (
  | {
      client: MongoClient;
    }
  | {
      connectionString: string;
      clientOptions?: MongoClientOptions;
    }
);

type InlineProjectionQueries = {
  findOne: <Doc extends Document, Projection = MongoDBReadModel<Doc>>(
    streamType: StreamType,
    projectionName: string,
    projectionQuery: Filter<MongoDBReadModel<Doc>>,
  ) => Promise<Projection | null>;
  find: <Doc extends Document, Projection = MongoDBReadModel<Doc>>(
    streamType: StreamType,
    projectionName: string,
    projectionQuery: Filter<MongoDBReadModel<Doc>>,
  ) => Promise<Projection[]>;
};

type ProjectionQueries = {
  inline: InlineProjectionQueries;
};

export type MongoDBEventStore = EventStore<MongoDBReadEventMetadata> & {
  projections: ProjectionQueries;
  close: () => Promise<void>;
};

class MongoDBEventStoreImplementation implements MongoDBEventStore {
  private readonly client: MongoClient;
  private readonly defaultOptions: {
    database: string | undefined;
    collection: string | undefined;
  };
  private readonly inlineProjections: MongoDBInlineProjectionDefinition[];
  private shouldManageClientLifetime: boolean;
  private db: Db | undefined;
  private streamCollections: Map<string, Collection<EventStream>> = new Map();
  private isClosed: boolean = false;

  public projections: ProjectionQueries;

  constructor(options: MongoDBEventStoreOptions) {
    this.client =
      'client' in options
        ? options.client
        : new MongoClient(options.connectionString, options.clientOptions);
    this.shouldManageClientLifetime = !('client' in options);
    this.defaultOptions = {
      database: options.database,
      collection: options.collection,
    };
    this.inlineProjections = (options.projections ?? [])
      .filter(({ type }) => type === 'inline')
      .map(
        ({ projection }) => projection,
      ) as MongoDBInlineProjectionDefinition[];

    this.projections = {
      inline: {
        find: this.findInlineProjection.bind(this),
        findOne: this.findOneInlineProjection.bind(this),
      },
    };
  }

  async readStream<EventType extends Event>(
    streamName: StreamName,
    options?: ReadStreamOptions,
  ): Promise<
    Exclude<ReadStreamResult<EventType, MongoDBReadEventMetadata>, null>
  > {
    const { streamType } = fromStreamName(streamName);
    const expectedStreamVersion = options?.expectedStreamVersion;

    const collection = await this.collectionFor(streamType);

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

    const stream = await collection.findOne<
      WithId<Pick<EventStream<EventType>, 'metadata' | 'messages'>>
    >(filter, {
      useBigInt64: true,
      projection: {
        metadata: 1,
        messages: eventsSlice,
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
      events: stream.messages,
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
    const { streamId, streamType } = fromStreamName(streamName);
    const expectedStreamVersion = options?.expectedStreamVersion;

    const collection = await this.collectionFor(streamType);

    const stream = await collection.findOne<
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

    const eventsToAppend: ReadEvent<
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

    const now = new Date();
    const updates: UpdateFilter<EventStream> = {
      $push: { messages: { $each: eventsToAppend } },
      $set: { 'metadata.updatedAt': now },
      $inc: { 'metadata.streamPosition': BigInt(events.length) },
      $setOnInsert: {
        'metadata.streamId': streamId,
        'metadata.streamType': streamType,
        'metadata.createdAt': now,
      },
    };

    if (this.inlineProjections) {
      await handleInlineProjections({
        readModels: stream?.projections ?? {},
        events: eventsToAppend,
        projections: this.inlineProjections,
        collection,
        updates,
        client: {},
      });
    }

    const updatedStream = await collection.updateOne(
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

    return {
      nextExpectedStreamVersion:
        currentStreamVersion + BigInt(eventsToAppend.length),
      createdNewStream:
        currentStreamVersion === MongoDBEventStoreDefaultStreamVersion,
    };
  }

  close(): Promise<void> {
    if (this.isClosed) return Promise.resolve();

    this.isClosed = true;
    if (!this.shouldManageClientLifetime) return Promise.resolve();

    return this.client.close();
  }

  private collectionFor = async <EventType extends Event>(
    streamType: StreamType,
  ): Promise<Collection<EventStream<EventType>>> => {
    const collectionName =
      this.defaultOptions?.collection ?? toStreamCollectionName(streamType);

    let collection = this.streamCollections.get(collectionName) as
      | Collection<EventStream<EventType>>
      | undefined;

    if (collection) return collection;

    const db = await this.getDB();
    collection = db.collection<EventStream<EventType>>(collectionName);

    this.streamCollections.set(
      collectionName,
      collection as Collection<EventStream>,
    );

    return collection;
  };

  private getDB = async (): Promise<Db> => {
    if (!this.db) {
      const connectedClient = await this.getConnectedClient();

      this.db = connectedClient.db(this.defaultOptions.database);
    }
    return this.db;
  };

  private getConnectedClient = async (): Promise<MongoClient> => {
    if (!this.isClosed) await this.client.connect();
    return this.client;
  };

  private async findOneInlineProjection<
    Doc extends Document,
    Projection = MongoDBReadModel<Doc>,
  >(
    streamType: StreamType,
    projectionName: string,
    projectionQuery: Filter<MongoDBReadModel<Doc>>,
  ) {
    const collection = await this.collectionFor(streamType);
    const query = prependObjectKeysToMongoQuery<Filter<EventStream>>(
      // @ts-expect-error we are turning the `Filter<ProjectSchema>` into a `Filter<EventStream>`
      projectionQuery,
      `projections.${projectionName}`,
    );

    const result = await collection.findOne<{
      projections: Record<typeof projectionName, Projection>;
    }>(
      {
        $and: [query, { [`projections.${projectionName}`]: { $exists: true } }],
      },
      {
        useBigInt64: true,
        projection: {
          [`projections.${projectionName}`]: 1,
        },
      },
    );

    return result?.projections?.[projectionName] ?? null;
  }

  private async findInlineProjection<
    Doc extends Document,
    Projection = MongoDBReadModel<Doc>,
  >(
    streamType: StreamType,
    projectionName: string,
    projectionQuery: Filter<MongoDBReadModel<Doc>>,
  ) {
    const collection = await this.collectionFor(streamType);
    const query = prependObjectKeysToMongoQuery<Filter<EventStream>>(
      // @ts-expect-error we are turning the `Filter<ProjectSchema>` into a `Filter<EventStream>`
      projectionQuery,
      `projections.${projectionName}`,
    );

    const streams = await collection
      .find<{
        projections: Record<typeof projectionName, Projection>;
      }>(
        {
          $and: [
            query,
            { [`projections.${projectionName}`]: { $exists: true } },
          ],
        },
        {
          useBigInt64: true,
          projection: {
            [`projections.${projectionName}`]: 1,
          },
        },
      )
      .toArray();

    return streams
      .map((s) => s.projections[projectionName])
      .filter((s): s is Projection => !!s);
  }
}

/**
 * Prepends `prefix` to all object keys that don't start with a '$'.
 */
function prependObjectKeysToMongoQuery<T>(obj: T, prefix: string): T {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  for (const key in obj) {
    // @ts-expect-error we're forcing `k` to be a key of `T`
    const k: keyof typeof obj = addPrefix(key, prefix);
    if (k !== key) {
      obj[k] = obj[key as keyof typeof obj];
      delete obj[key as keyof typeof obj];
    }

    obj[k] = prependObjectKeysToMongoQuery(obj[k], prefix);
  }

  return obj;
}

function addPrefix(key: string, prefix: string): string {
  // MongoDB operators
  if (key[0] === '$') {
    return key;
  }

  // Query on root stream object
  if (key === 'streamName') {
    return key;
  }

  // TODO: add in support for querying based on root stream metadata
  // TODO: add unit tests without exposing these functions. probably move to different file that's imported here but not exported from main module.

  return `${prefix}${key.length > 0 ? '.' : ''}${key}`;
}

export const getMongoDBEventStore = (
  options: MongoDBEventStoreOptions,
): MongoDBEventStore => new MongoDBEventStoreImplementation(options);

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

/**
 * Accepts a `streamType` (the type/category of the event stream)
 * and combines them to a `collectionName` which can be used in `EventStore`.
 */
export function toStreamCollectionName<T extends StreamType>(
  streamType: T,
): StreamCollectionName<T> {
  return `emt:${streamType}`;
}

/**
 * Accepts a fully formatted `streamCollectionName` and returns the parsed `streamType`.
 */
export function fromStreamCollectionName<T extends StreamType>(
  streamCollectionName: StreamCollectionName<T>,
): StreamCollectionNameParts<T> {
  const parts = streamCollectionName.split(':') as [string, T];
  return {
    streamType: parts[1],
  };
}
