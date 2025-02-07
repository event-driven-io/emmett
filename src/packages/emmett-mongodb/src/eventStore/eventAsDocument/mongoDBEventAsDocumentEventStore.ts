import {
  filterProjections,
  type AggregateStreamOptions,
  type AggregateStreamResult,
  type AppendToStreamOptions,
  type AppendToStreamResult,
  type DefaultEventStoreOptions,
  type Event,
  type EventStore,
  type ProjectionRegistration,
  type ReadStreamOptions,
  type ReadStreamResult,
} from 'packages/emmett/src';
// TODO: put these in a shared file
import {
  MongoDBEventStoreDefaultStreamVersion,
  type MongoDBEventStoreConnectionOptions,
  type MongoDBInlineProjectionDefinition,
  type MongoDBProjectionInlineHandlerContext,
  type MongoDBReadEventMetadata,
  type ProjectionQueries,
  type StreamType,
} from '../streamAsDocument';
import { MongoClient, type Filter, type WithId } from 'mongodb';

// TODO: other properties
type Stream = {
  streamName: string;
  _metadata: {
    streamId: string;
    streamPosition: bigint;
  };
};

export type MongoDBEventAsDocumentEventStore =
  EventStore<MongoDBReadEventMetadata> & {
    // TODO: these type defs need to change
    projections: ProjectionQueries<StreamType>;
  };

export type MongoDBEventAsDocumentEventStoreOptions = {
  projections?: ProjectionRegistration<
    'inline',
    MongoDBReadEventMetadata,
    MongoDBProjectionInlineHandlerContext
  >[];
  // TODO: storage options?
} & MongoDBEventStoreConnectionOptions &
  DefaultEventStoreOptions<MongoDBEventAsDocumentEventStore>;

export class MongoDBEventAsDocumentEventStoreImplementation
  implements MongoDBEventAsDocumentEventStore
{
  private readonly client: MongoClient;
  private readonly inlineProjections: MongoDBInlineProjectionDefinition[];
  private shouldManageClientLifetime: boolean;
  private isClosed: boolean = false;
  private options: MongoDBEventAsDocumentEventStoreOptions;
  public projections: ProjectionQueries<StreamType>;

  constructor(options: MongoDBEventAsDocumentEventStoreOptions) {
    this.options = options;
    this.client =
      'client' in options && options.client
        ? options.client
        : new MongoClient(options.connectionString, options.clientOptions);
    this.shouldManageClientLifetime = !('client' in options);
    this.inlineProjections = filterProjections(
      'inline',
      options.projections ?? [],
    ) as MongoDBInlineProjectionDefinition[];

    this.projections = {
      // @ts-expect-error TODO:
      inline: {},
    };
  }

  async readStream<EventType extends Event>(
    streamName: string,
    options?: ReadStreamOptions,
  ): Promise<
    ReadStreamResult<
      EventType,
      Readonly<{ eventId: string; streamPosition: bigint; streamName: string }>
    >
  > {
    const eventsCollection = this.getEventsCollection<EventType>();
    const streamsCollection = this.getStreamsCollection();

    const stream = await streamsCollection.findOne({
      streamName: { $eq: streamName },
    });

    if (!stream) {
      return {
        events: [],
        currentStreamVersion: MongoDBEventStoreDefaultStreamVersion,
        streamExists: false,
      };
    }

    // @ts-expect-error TODO: fix event type definitions
    const filter: Filter<EventType> = {
      'metadata.streamName': { $eq: streamName },
    };

    // @ts-expect-error TODO: fix event type definitions
    filter['metadata.streamPosition'] = {
      $gte: options && 'from' in options ? options.from : 0,
    };

    if (options && 'to' in options) {
      // TODO: fix event type definitions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      filter['metadata.streamPosition'].$lte = options.to;
    }

    const events = await eventsCollection
      .find(filter, {
        useBigInt64: true,
      })
      .toArray();

    return {
      //  @ts-expect-error TODO: fix event type definitions
      events: events,
      currentStreamVersion: stream._metadata.streamPosition,
      streamExists: true,
    };
  }

  appendToStream<EventType extends Event>(
    streamName: string,
    events: EventType[],
    options?: AppendToStreamOptions<bigint> | undefined,
  ): Promise<AppendToStreamResult<bigint>> {}

  aggregateStream<State, EventType extends Event>(
    streamName: string,
    options: AggregateStreamOptions<
      State,
      EventType,
      Readonly<{ eventId: string; streamPosition: bigint; streamName: string }>
    >,
  ): Promise<AggregateStreamResult<State, bigint>> {}

  private getEventsCollection<EventType extends Event>() {
    // TODO: caching dbs and get proper db based on options
    const db = this.client.db();

    return db.collection<EventType>('events');
  }

  private getStreamsCollection() {
    // TODO: caching dbs and get proper db based on options
    const db = this.client.db();

    return db.collection<Stream>('events');
  }
}
