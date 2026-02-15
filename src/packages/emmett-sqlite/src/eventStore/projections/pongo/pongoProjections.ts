import type {
  CanHandle,
  Event,
  EventStoreReadSchemaOptions,
  ReadEvent,
  TruncateProjection,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoDBCollectionOptions,
  type PongoDocument,
} from '@event-driven-io/pongo';
import {
  sqliteProjection,
  type SQLiteProjectionDefinition,
  type SQLiteProjectionHandlerContext,
} from '..';
import type { SQLiteReadEventMetadata } from '../../SQLiteEventStore';

export type PongoProjectionHandlerContext = SQLiteProjectionHandlerContext & {
  pongo: PongoClient;
};

export type PongoWithNotNullDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
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
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
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
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
> =
  | PongoWithNotNullDocumentEvolve<Document, EventType, EventMetaDataType>
  | PongoWithNullableDocumentEvolve<Document, EventType, EventMetaDataType>;

export type PongoProjectionOptions<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
> = {
  name: string;
  kind?: string;
  version?: number;
  handle: (
    events: ReadEvent<EventType, SQLiteReadEventMetadata>[],
    context: PongoProjectionHandlerContext,
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
  truncate?: TruncateProjection<PongoProjectionHandlerContext>;
  init?: (context: PongoProjectionHandlerContext) => void | Promise<void>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
};

export const pongoProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>({
  name,
  kind,
  version,
  truncate,
  handle,
  canHandle,
  eventsOptions,
}: PongoProjectionOptions<
  EventType,
  EventPayloadType
>): SQLiteProjectionDefinition<EventType, EventPayloadType> =>
  sqliteProjection<EventType, EventPayloadType>({
    name,
    version,
    kind: kind ?? 'emt:projections:postgresql:pongo:generic',
    canHandle,
    eventsOptions,
    handle: async (events, context) => {
      const { connection } = context;
      const driver = (await pongoDriverRegistry.tryResolve(
        context.driverType,
      ))!;
      const pongo = pongoClient({
        driver,
        connectionOptions: { connection },
      });
      try {
        await handle(events, {
          ...context,
          pongo,
        });
      } finally {
        await pongo.close();
      }
    },
    truncate: truncate
      ? async (context) => {
          const { connection } = context;
          const driver = (await pongoDriverRegistry.tryResolve(
            context.driverType,
          ))!;
          const pongo = pongoClient({
            driver,
            connectionOptions: { connection },
          });
          try {
            await truncate({
              ...context,
              pongo,
            });
          } finally {
            await pongo.close();
          }
        }
      : undefined,
  });

export type PongoMultiStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  EventPayloadType extends Event = EventType,
  DocumentPayload extends PongoDocument = Document,
> = {
  kind?: string;
  canHandle: CanHandle<EventType>;
  version?: number;
  collectionName: string;
  collectionOptions?: PongoDBCollectionOptions<Document, DocumentPayload>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
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
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  EventPayloadType extends Event = EventType,
>(
  options: PongoMultiStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType,
    EventPayloadType
  >,
): SQLiteProjectionDefinition<EventType, EventPayloadType> => {
  const { collectionName, getDocumentId, canHandle } = options;
  const collectionNameWithVersion =
    options.version && options.version > 0
      ? `${collectionName}_v${options.version}`
      : collectionName;

  return pongoProjection({
    name: collectionNameWithVersion,
    version: options.version,
    kind: options.kind ?? 'emt:projections:postgresql:pongo:multi_stream',
    eventsOptions: options.eventsOptions,
    handle: async (events, { pongo }) => {
      const collection = pongo
        .db()
        .collection<Document>(
          collectionNameWithVersion,
          options.collectionOptions,
        );

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
    truncate: async (context) => {
      const { connection } = context;
      const driver = (await pongoDriverRegistry.tryResolve(
        context.driverType,
      ))!;
      const pongo = pongoClient({
        driver,
        connectionOptions: { connection },
      });

      try {
        await pongo
          .db()
          .collection<Document>(
            collectionNameWithVersion,
            options.collectionOptions,
          )
          .deleteMany();
      } finally {
        await pongo.close();
      }
    },
    init: async (context) => {
      const { connection } = context;
      const driver = (await pongoDriverRegistry.tryResolve(
        context.driverType,
      ))!;
      const pongo = pongoClient({
        connectionOptions: { connection },
        driver,
      });

      try {
        await pongo
          .db()
          .collection<Document>(
            collectionNameWithVersion,
            options.collectionOptions,
          )
          .schema.migrate(); // TODO: ADD migration optionscontext.migrationOptions);
      } finally {
        await pongo.close();
      }
    },
  });
};

export type PongoSingleStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  EventPayloadType extends Event = EventType,
  DocumentPayload extends PongoDocument = Document,
> = {
  canHandle: CanHandle<EventType>;
  getDocumentId?: (event: ReadEvent<EventType>) => string;
  version?: number;
  collectionName: string;
  collectionOptions?: PongoDBCollectionOptions<Document, DocumentPayload>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
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
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  EventPayloadType extends Event = EventType,
>(
  options: PongoSingleStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType,
    EventPayloadType
  >,
): SQLiteProjectionDefinition<EventType, EventPayloadType> => {
  return pongoMultiStreamProjection<
    Document,
    EventType,
    EventMetaDataType,
    EventPayloadType
  >({
    ...options,
    kind: 'emt:projections:postgresql:pongo:single_stream',
    getDocumentId:
      options.getDocumentId ?? ((event) => event.metadata.streamName),
  });
};
