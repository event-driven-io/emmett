import {
  type CanHandle,
  type Event,
  type ProjectionHandler,
  type ReadEvent,
  type TypedProjectionDefinition,
} from '@event-driven-io/emmett';
import type { Collection, Document, UpdateFilter } from 'mongodb';
import type {
  EventStream,
  MongoDBReadEventMetadata,
  MongoDBReadModel,
  MongoDBReadModelMetadata,
} from '../mongoDBEventStore';

export const MongoDBDefaultInlineProjectionName = '_default';

export type MongoDBProjectionInlineHandlerContext<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> = {
  document: MongoDBReadModel | null;
  streamId: string;
  updates: UpdateFilter<EventStream<EventType, EventMetaDataType>>;
  collection: Collection<EventStream<EventType, EventMetaDataType>>;
};

export type MongoDBInlineProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  MongoDBProjectionInlineHandlerContext
>;

export type MongoDBInlineProjectionDefinition<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> = TypedProjectionDefinition<
  EventType,
  EventMetaDataType,
  MongoDBProjectionInlineHandlerContext
> & { name: string };

export type InlineProjectionHandlerOptions<
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> = {
  readModels: Record<string, MongoDBReadModel>;
  events: Array<ReadEvent<EventType, EventMetaDataType>>;
  projections: MongoDBInlineProjectionDefinition<
    EventType,
    EventMetaDataType
  >[];
  streamId: string;
  collection: Collection<EventStream>;
  updates: UpdateFilter<EventStream<Event>>;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  client: {
    //todo: add client here
  };
};

export const handleInlineProjections = async <
  EventType extends Event = Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
>(
  options: InlineProjectionHandlerOptions<EventType, EventMetaDataType>,
): Promise<void> => {
  const {
    events,
    projections: allProjections,
    updates: update,
    streamId,
    collection,
    readModels,
  } = options;

  const eventTypes = events.map((e) => e.type);

  const projections = allProjections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  for (const projection of projections) {
    await projection.handle(events, {
      document: readModels[projection.name] ?? null,
      streamId,
      collection,
      updates: update,
    });
  }
};

export type MongoDBWithNotNullDocumentEvolve<
  Doc extends Document,
  EventType extends Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> =
  | ((
      document: Doc,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Doc | null)
  | ((document: Doc, event: ReadEvent<EventType>) => Promise<Doc | null>);

export type MongoDBWithNullableDocumentEvolve<
  Doc extends Document,
  EventType extends Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> =
  | ((
      document: Doc | null,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Doc | null)
  | ((
      document: Doc | null,
      event: ReadEvent<EventType>,
    ) => Promise<Doc | null>);

export type MongoDBInlineProjectionOptions<
  Doc extends Document,
  EventType extends Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
> = {
  name?: string;
  schemaVersion?: number;
  canHandle: CanHandle<EventType>;
} & (
  | {
      evolve: MongoDBWithNullableDocumentEvolve<
        Doc,
        EventType,
        EventMetaDataType
      >;
    }
  | {
      evolve: MongoDBWithNotNullDocumentEvolve<
        Doc,
        EventType,
        EventMetaDataType
      >;
      initialState: () => Doc;
    }
);

export const mongoDBInlineProjection = <
  Doc extends Document,
  EventType extends Event,
  EventMetaDataType extends MongoDBReadEventMetadata = MongoDBReadEventMetadata,
>(
  options: MongoDBInlineProjectionOptions<Doc, EventType, EventMetaDataType>,
): MongoDBInlineProjectionDefinition => {
  const projectionName = options.name ?? MongoDBDefaultInlineProjectionName;
  const schemaVersion = options.schemaVersion ?? 1;

  return {
    name: projectionName,
    canHandle: options.canHandle,
    handle: async (events, { document, updates, streamId }) => {
      if (events.length === 0) return;

      let state =
        'initialState' in options
          ? (document ?? options.initialState())
          : document;

      for (const event of events) {
        state = await options.evolve(
          state as Doc,
          event as ReadEvent<EventType, EventMetaDataType>,
        );
      }

      const metadata: MongoDBReadModelMetadata = {
        streamId,
        name: projectionName,
        schemaVersion,
        streamPosition: events[events.length - 1]!.metadata.streamPosition,
      };

      updates.$set![`projections.${projectionName}`] =
        state !== null
          ? {
              ...state,
              _metadata: metadata,
            }
          : null;
    },
  };
};
