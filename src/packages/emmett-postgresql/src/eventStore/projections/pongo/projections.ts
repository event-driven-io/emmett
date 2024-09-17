import {
  type CanHandle,
  type Event,
  type EventMetaDataOf,
  type ReadEvent,
  type ReadEventMetadataWithGlobalPosition,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoDocument,
} from '@event-driven-io/pongo';
import {
  postgreSQLProjection,
  type PostgreSQLProjectionDefinition,
  type PostgreSQLProjectionHandlerContext,
} from '..';

export type PongoProjectionHandlerContext =
  PostgreSQLProjectionHandlerContext & {
    pongo: PongoClient;
  };

export type PongoWithNotNullDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> =
  | ((
      document: Document,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Document | null)
  | ((
      document: Document,
      event: ReadEvent<EventType>,
    ) => Promise<Document | null>);

export type PongoWithNullableDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> =
  | ((
      document: Document | null,
      event: ReadEvent<EventType, EventMetaDataType>,
    ) => Document | null)
  | ((
      document: Document | null,
      event: ReadEvent<EventType>,
    ) => Promise<Document | null>);

export type PongoDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> =
  | PongoWithNotNullDocumentEvolve<Document, EventType, EventMetaDataType>
  | PongoWithNullableDocumentEvolve<Document, EventType, EventMetaDataType>;

export type PongoProjectionOptions<
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> = {
  handle: (
    events: ReadEvent<EventType, EventMetaDataType>[],
    context: PongoProjectionHandlerContext,
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
};

export const pongoProjection = <
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
>({
  handle,
  canHandle,
}: PongoProjectionOptions<
  EventType,
  EventMetaDataType
>): PostgreSQLProjectionDefinition =>
  postgreSQLProjection<EventType, EventMetaDataType>({
    canHandle,
    handle: async (events, context) => {
      const { connectionString, client } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client },
      });
      await handle(events as ReadEvent<EventType, EventMetaDataType>[], {
        ...context,
        pongo,
      });
    },
  });

export type PongoMultiStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> = {
  canHandle: CanHandle<EventType>;

  collectionName: string;
  getDocumentId: (event: ReadEvent<EventType>) => string;
} & (
  | {
      evolve: PongoWithNullableDocumentEvolve<
        Document,
        EventType,
        EventMetaDataType
      >;
    }
  | {
      evolve: PongoWithNotNullDocumentEvolve<
        Document,
        EventType,
        EventMetaDataType
      >;
      initialState: () => Document;
    }
);

export const pongoMultiStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
>(
  options: PongoMultiStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition => {
  const { collectionName, getDocumentId, canHandle } = options;

  return pongoProjection({
    handle: async (events, { pongo }) => {
      const collection = pongo.db().collection<Document>(collectionName);

      for (const event of events) {
        await collection.handle(getDocumentId(event), async (document) => {
          return 'initialState' in options
            ? await options.evolve(
                document ?? options.initialState(),
                event as ReadEvent<EventType, EventMetaDataType>,
              )
            : await options.evolve(
                document,
                event as ReadEvent<EventType, EventMetaDataType>,
              );
        });
      }
    },
    canHandle,
  });
};

export type PongoSingleStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
> = {
  canHandle: CanHandle<EventType>;

  collectionName: string;
} & (
  | {
      evolve: PongoWithNullableDocumentEvolve<
        Document,
        EventType,
        EventMetaDataType
      >;
    }
  | {
      evolve: PongoWithNotNullDocumentEvolve<
        Document,
        EventType,
        EventMetaDataType
      >;
      initialState: () => Document;
    }
);

export const pongoSingleStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition = EventMetaDataOf<EventType> &
    ReadEventMetadataWithGlobalPosition,
>(
  options: PongoSingleStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition => {
  return pongoMultiStreamProjection<Document, EventType, EventMetaDataType>({
    ...options,
    getDocumentId: (event) => event.metadata.streamName,
  });
};
