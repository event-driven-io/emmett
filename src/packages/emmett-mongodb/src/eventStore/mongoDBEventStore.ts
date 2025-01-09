import {
  ExpectedVersionConflictError,
  assertExpectedVersionMatchesCurrent,
  filterProjections,
  tryPublishMessagesAfterCommit,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type Closeable,
  type Event,
  type EventStore,
  type ProjectionRegistration,
  type ReadEvent,
  type ReadEventMetadataWithoutGlobalPosition,
  type ReadStreamOptions,
  type ReadStreamResult,
  type DefaultEventStoreOptions,
} from '@event-driven-io/emmett';
import {
  MongoClient,
  type Collection,
  type Document,
  type Filter,
  type MongoClientOptions,
  type Sort,
  type UpdateFilter,
  type WithId,
} from 'mongodb';
import { v4 as uuid } from 'uuid';
import {
  handleInlineProjections,
  MongoDBDefaultInlineProjectionName,
  type MongoDBInlineProjectionDefinition,
  type MongoDBProjectionInlineHandlerContext,
} from './projections';
import {
  mongoDBEventStoreStorage,
  type MongoDBEventStoreStorage,
  type MongoDBEventStoreStorageOptions,
} from './storage';

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
  streamId: string;
  name: string;
  schemaVersion: number;
  streamPosition: bigint;
};

export type MongoDBReadModel<Doc extends Document = Document> = Doc & {
  _metadata: MongoDBReadModelMetadata;
};

export interface EventStream<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
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

type SingleProjectionQueryStreamFilter<T extends StreamType> = {
  projectionName?: string;
} & ({ streamName: StreamName<T> } | { streamType: T; streamId?: string });

type MultiProjectionQueryStreamFilter<T extends StreamType> = {
  projectionName?: string;
} & (
  | { streamNames: StreamName<T>[] }
  | { streamType: T; streamIds?: string[] }
);

type MultiProjectionQueryOptions = {
  skip?: number;
  limit?: number;
  sort?: [string, 1 | -1][] | Record<string, 1 | -1>;
};

/**
 * Helpers for querying inline projections on event streams.
 */
type InlineProjectionQueries<T extends StreamType> = {
  /**
   * Helper for querying for a single projection. Similar to `collection.findOne`.
   * @param streamFilter - A filter object for stream level fields. If `streamType` is required if `streamName` is not provided. If `projectionName` is not provided, the default projection will be used (`MongoDBDefaultInlineProjectionName`).
   * @param projectionQuery - A MongoDB filter query based on the projection schema. Internally, this function will prepend each object key with the necessary projection name.
   */
  findOne: <Doc extends Document>(
    streamFilter: SingleProjectionQueryStreamFilter<T>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
  ) => Promise<MongoDBReadModel<Doc> | null>;
  /**
   * Helper for querying for multiple projections. Similar to `collection.find`.
   *
   * ***NOTE***: If `streamFilter.streamNames` is an empty array, this function will return an empty array. If `streamFilter.streamIds` is an empty array, the `streamIds` filter will not be used.
   *
   * @param streamFilter - A filter object for stream level fields. If `streamType` is required if `streamNames` is not provided. If `projectionName` is not provided, the default projection will be used (`MongoDBDefaultInlineProjectionName`).
   * @param projectionQuery - A MongoDB filter query based on the projection schema. Internally, this function will prepend each object key with the necessary projection name.
   * @param queryOptions - Additional query options like `skip`, `limit`, and `sort`. `sort`, similar to `projectionQuery`, will prepend each object key with the necessary projection name.
   */
  find: <Doc extends Document>(
    streamFilter: MultiProjectionQueryStreamFilter<T>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
    queryOptions?: MultiProjectionQueryOptions,
  ) => Promise<MongoDBReadModel<Doc>[]>;
  /**
   * Returns the total number of documents matching the provided filter options. Similar to `collection.countDocuments`.
   *
   * ***NOTE***: If `streamFilter.streamNames` is an empty array, this function will return `0`. If `streamFilter.streamIds` is an empty array, the `streamIds` filter will not be used.
   *
   * @param streamFilter - A filter object for stream level fields. If `streamType` is required if `streamNames` is not provided. If `projectionName` is not provided, the default projection will be used (`MongoDBDefaultInlineProjectionName`).
   * @param projectionQuery - A MongoDB filter query based on the projection schema. Internally, this function will prepend each object key with the necessary projection name.
   */
  count: <Doc extends Document>(
    streamFilter: MultiProjectionQueryStreamFilter<T>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
  ) => Promise<number>;
};

/**
 * Helpers for querying projections on event streams.
 */
type ProjectionQueries<T extends StreamType> = {
  inline: InlineProjectionQueries<T>;
};

export type MongoDBEventStoreClientOptions = {
  client: MongoClient;
  connectionString?: never;
  clientOptions?: never;
};

export type MongoDBEventStoreConnectionStringOptions = {
  client?: never;
  connectionString: string;
  clientOptions?: MongoClientOptions;
};

export type MongoDBEventStoreConnectionOptions =
  | MongoDBEventStoreClientOptions
  | MongoDBEventStoreConnectionStringOptions;

export type MongoDBEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    MongoDBReadEventMetadata,
    MongoDBProjectionInlineHandlerContext
  >[];
  storage?: MongoDBEventStoreStorageOptions;
} & MongoDBEventStoreConnectionOptions &
  DefaultEventStoreOptions<MongoDBEventStore>;

export type MongoDBEventStore = EventStore<MongoDBReadEventMetadata> & {
  projections: ProjectionQueries<StreamType>;
  collectionFor: <EventType extends Event>(
    streamType: StreamType,
  ) => Promise<Collection<EventStream<EventType>>>;
};

class MongoDBEventStoreImplementation implements MongoDBEventStore, Closeable {
  private readonly client: MongoClient;
  private readonly inlineProjections: MongoDBInlineProjectionDefinition[];
  private shouldManageClientLifetime: boolean;
  private isClosed: boolean = false;
  private storage: MongoDBEventStoreStorage;
  private options: MongoDBEventStoreOptions;
  public projections: ProjectionQueries<StreamType>;

  constructor(options: MongoDBEventStoreOptions) {
    this.options = options;
    this.client =
      'client' in options && options.client
        ? options.client
        : new MongoClient(options.connectionString, options.clientOptions);
    this.shouldManageClientLifetime = !('client' in options);
    this.storage = mongoDBEventStoreStorage({
      storage: options.storage,
      getConnectedClient: () => this.getConnectedClient(),
    });
    this.inlineProjections = filterProjections(
      'inline',
      options.projections ?? [],
    ) as MongoDBInlineProjectionDefinition[];

    this.projections = {
      inline: {
        findOne: this.findOneInlineProjection.bind(this),
        find: this.findInlineProjection.bind(this),
        count: this.countInlineProjection.bind(this),
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

    const collection = await this.storage.collectionFor(streamType);

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

    const collection = await this.storage.collectionFor(streamType);

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

    const eventsToAppend: ReadEvent<EventType, MongoDBReadEventMetadata>[] =
      events.map((event) => {
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
            ...('metadata' in event ? (event.metadata ?? {}) : {}),
          },
        } as ReadEvent<EventType, MongoDBReadEventMetadata>;
      });

    const now = new Date();
    const updates: UpdateFilter<EventStream> = {
      $push: { messages: { $each: eventsToAppend } },
      $set: {
        'metadata.updatedAt': now,
        'metadata.streamPosition': currentStreamVersion + BigInt(events.length),
      },
      $setOnInsert: {
        streamName,
        'metadata.streamId': streamId,
        'metadata.streamType': streamType,
        'metadata.createdAt': now,
      },
    };

    if (this.inlineProjections) {
      await handleInlineProjections({
        readModels: stream?.projections ?? {},
        streamId,
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
        'metadata.streamPosition': currentStreamVersion,
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

    await tryPublishMessagesAfterCommit<MongoDBEventStore>(
      // @ts-expect-error Issues with `globalPosition` not being present causing the type for metadata to expect `never`
      eventsToAppend,
      this.options.hooks,
      // {
      // TODO: same context as InlineProjectionHandlerContext for mongodb?
      // },
    );

    return {
      nextExpectedStreamVersion:
        currentStreamVersion + BigInt(eventsToAppend.length),
      createdNewStream:
        currentStreamVersion === MongoDBEventStoreDefaultStreamVersion,
    };
  }

  collectionFor = async <EventType extends Event>(
    streamType: StreamType,
  ): Promise<Collection<EventStream<EventType>>> => {
    return this.storage.collectionFor(streamType);
  };

  /**
   * Gracefully cleans up managed resources by the MongoDBEventStore.
   * It closes MongoDB client created for the provided connection string
   * through event store options.
   *
   * @memberof Closeable
   */
  close = (): Promise<void> => {
    if (this.isClosed) return Promise.resolve();

    this.isClosed = true;
    if (!this.shouldManageClientLifetime) return Promise.resolve();

    return this.client.close();
  };

  private async findOneInlineProjection<Doc extends Document>(
    streamFilter: SingleProjectionQueryStreamFilter<StreamType>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
  ) {
    const { projectionName, streamName, streamType } =
      parseSingleProjectionQueryStreamFilter(streamFilter);
    const collection = await this.storage.collectionFor(streamType);
    const query = prependMongoFilterWithProjectionPrefix<
      Filter<MongoDBReadModel<Doc>> | undefined,
      Filter<EventStream> | undefined
    >(projectionQuery, `projections.${projectionName}`);

    const filters: Filter<EventStream>[] = [
      { [`projections.${projectionName}`]: { $exists: true } },
    ];

    if (query) {
      filters.push(query);
    }

    if (streamName) {
      filters.push({ streamName: { $eq: streamName } });
    }

    const result = await collection.findOne<{
      projections: Record<typeof projectionName, MongoDBReadModel<Doc>>;
    }>(
      { $and: filters },
      {
        useBigInt64: true,
        projection: { [`projections.${projectionName}`]: 1 },
      },
    );

    return result?.projections?.[projectionName] ?? null;
  }

  private async findInlineProjection<Doc extends Document>(
    streamFilter: MultiProjectionQueryStreamFilter<StreamType>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
    queryOptions?: MultiProjectionQueryOptions,
  ) {
    const parsedStreamFilter =
      parseMultiProjectionQueryStreamFilter(streamFilter);
    if (!parsedStreamFilter) return [];
    const { projectionName, streamNames, streamType } = parsedStreamFilter;

    const collection = await this.storage.collectionFor(streamType);
    const prefix = `projections.${projectionName}`;
    const projectionFilter = prependMongoFilterWithProjectionPrefix<
      Filter<MongoDBReadModel<Doc>> | undefined,
      Filter<EventStream> | undefined
    >(projectionQuery, prefix);

    const filters: Filter<EventStream>[] = [
      { [`projections.${projectionName}`]: { $exists: true } },
    ];

    if (projectionFilter) {
      filters.push(projectionFilter);
    }

    if (streamNames) {
      filters.push({ streamName: { $in: streamNames } });
    }

    let query = collection.find<
      EventStream & {
        projections: Record<typeof projectionName, MongoDBReadModel<Doc>>;
      }
    >(
      { $and: filters },
      {
        useBigInt64: true,
        projection: { [`projections.${projectionName}`]: 1 },
      },
    );

    if (queryOptions?.skip) {
      query = query.skip(queryOptions.skip);
    }

    if (queryOptions?.limit) {
      query = query.limit(queryOptions.limit);
    }

    if (queryOptions?.sort) {
      const sort = prependMongoFilterWithProjectionPrefix<Sort>(
        queryOptions.sort,
        prefix,
      );
      query = query.sort(sort);
    }

    const streams = await query.toArray();

    return streams
      .map((s) => s.projections[projectionName])
      .filter((p): p is MongoDBReadModel<Doc> => !!p);
  }

  private async countInlineProjection<Doc extends Document>(
    streamFilter: MultiProjectionQueryStreamFilter<StreamType>,
    projectionQuery?: Filter<MongoDBReadModel<Doc>>,
  ) {
    const parsedStreamFilter =
      parseMultiProjectionQueryStreamFilter(streamFilter);
    if (!parsedStreamFilter) return 0;
    const { projectionName, streamNames, streamType } = parsedStreamFilter;

    const collection = await this.storage.collectionFor(streamType);
    const prefix = `projections.${projectionName}`;
    const projectionFilter = prependMongoFilterWithProjectionPrefix<
      Filter<MongoDBReadModel<Doc>> | undefined,
      Filter<EventStream> | undefined
    >(projectionQuery, prefix);

    const filters: Filter<EventStream>[] = [
      { [`projections.${projectionName}`]: { $exists: true } },
    ];

    if (projectionFilter) {
      filters.push(projectionFilter);
    }

    if (streamNames) {
      filters.push({ streamName: { $in: streamNames } });
    }

    const total = await collection.countDocuments({ $and: filters });
    return total;
  }

  private getConnectedClient = async (): Promise<MongoClient> => {
    if (!this.isClosed) await this.client.connect();
    return this.client;
  };
}

function parseSingleProjectionQueryStreamFilter<
  T extends StreamType = StreamType,
>(streamFilter: SingleProjectionQueryStreamFilter<T>) {
  const projectionName =
    streamFilter.projectionName ?? MongoDBDefaultInlineProjectionName;

  if ('streamName' in streamFilter) {
    const { streamType } = fromStreamName(streamFilter.streamName);
    return {
      projectionName,
      streamName: streamFilter.streamName,
      streamType,
    };
  }

  if (streamFilter.streamId) {
    const streamName = toStreamName(
      streamFilter.streamType,
      streamFilter.streamId,
    );
    return {
      projectionName,
      streamName,
      streamType: streamFilter.streamType,
    };
  }

  return {
    projectionName,
    streamType: streamFilter.streamType,
  };
}

function parseMultiProjectionQueryStreamFilter<T extends StreamType>(
  streamFilter: MultiProjectionQueryStreamFilter<T>,
) {
  const projectionName =
    streamFilter.projectionName ?? MongoDBDefaultInlineProjectionName;

  if ('streamNames' in streamFilter) {
    if (streamFilter.streamNames.length == 0) return null;
    const { streamType } = fromStreamName(streamFilter.streamNames[0]!);
    return {
      projectionName,
      streamNames: streamFilter.streamNames,
      streamType,
    };
  }

  if (streamFilter.streamIds && streamFilter.streamIds.length > 0) {
    const streamNames = streamFilter.streamIds.map((id) =>
      toStreamName(streamFilter.streamType, id),
    );
    return {
      projectionName,
      streamNames,
      streamType: streamFilter.streamType,
    };
  }

  return {
    projectionName,
    streamType: streamFilter.streamType,
  };
}

/**
 * Prepends `prefix` to all object keys that don't start with a '$'
 */
export function prependMongoFilterWithProjectionPrefix<T, Result = T>(
  obj: T,
  prefix: string,
): Result {
  if (typeof obj !== 'object' || obj === null || obj === undefined) {
    return obj as unknown as Result;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      obj[i] = prependMongoFilterWithProjectionPrefix(obj[i], prefix);
    }
    return obj as unknown as Result;
  }

  for (const key in obj) {
    // @ts-expect-error we're forcing `k` to be a key of `T`
    const k: keyof typeof obj = addProjectionPrefixToMongoKey(key, prefix);
    if (k !== key) {
      obj[k] = obj[key as keyof typeof obj];
      delete obj[key as keyof typeof obj];
    }

    obj[k] = prependMongoFilterWithProjectionPrefix(obj[k], prefix);
  }

  return obj as unknown as Result;
}

function addProjectionPrefixToMongoKey(key: string, prefix: string): string {
  // MongoDB operators
  if (key[0] === '$') {
    return key;
  }

  return `${prefix}${key.length > 0 ? '.' : ''}${key}`;
}

export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & { client: MongoClient },
): MongoDBEventStore;

export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions & { connectionString: string },
): MongoDBEventStore & Closeable;

// Implementation signature covers both, using a union for `options`
export function getMongoDBEventStore(
  options: MongoDBEventStoreOptions,
): MongoDBEventStore | Closeable {
  const impl = new MongoDBEventStoreImplementation(options);

  // If a client is provided externally, we don't want to allow closing it
  if ('client' in options && 'close' in impl) {
    delete (impl as Partial<MongoDBEventStoreImplementation>).close;
  }

  return impl;
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
