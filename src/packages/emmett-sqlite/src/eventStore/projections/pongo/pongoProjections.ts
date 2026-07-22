import {
  reduceAsync,
  type CanHandle,
  type Event,
  type EventStoreReadSchemaOptions,
  type JSONSerializationOptions,
  type ReadEvent,
  type TruncateProjection,
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
} & JSONSerializationOptions;

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
  init,
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
        schema: { autoMigration: 'None' },
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
    init: init
      ? async (options) => {
          const { connection } = options.context;
          const driver = (await pongoDriverRegistry.tryResolve(
            options.context.driverType,
          ))!;
          const pongo = pongoClient({
            driver,
            connectionOptions: { connection },
          });
          try {
            await init({
              ...options.context,
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
} & (
  | {
      getDocumentId: (event: ReadEvent<EventType>) => string | null;
      getDocumentIds?: never;
    }
  | {
      getDocumentId?: never;
      getDocumentIds: (event: ReadEvent<EventType>) => string[];
    }
) &
  (
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
  ) &
  JSONSerializationOptions;

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
  const { collectionName, getDocumentId, getDocumentIds, canHandle } = options;
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

      const eventsByDocumentId = events
        .flatMap((event) => {
          const documentIds = getDocumentId
            ? [getDocumentId(event)].filter((e) => e !== null)
            : getDocumentIds(event);

          return documentIds.map((documentId) => ({
            documentId,
            event: event as ReadEvent<EventType, EventMetaDataType>,
          }));
        })
        .reduce((acc, { documentId, event }) => {
          if (!acc.has(documentId)) {
            acc.set(documentId, []);
          }
          acc.get(documentId)!.push(event);
          return acc;
        }, new Map<string, ReadEvent<EventType, EventMetaDataType>[]>());

      await collection.handle(
        [...eventsByDocumentId.keys()],
        (document, id) => {
          const events = eventsByDocumentId.get(id)!;

          return reduceAsync(
            events,
            async (acc, event) => await options.evolve(acc!, event),
            document ??
              ('initialState' in options ? options.initialState() : null),
          );
        },
      );
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
      await context.pongo
        .db()
        .collection<Document>(
          collectionNameWithVersion,
          options.collectionOptions,
        )
        .schema.migrate(); // TODO: ADD migration optionscontext.migrationOptions);
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
  version?: number;
  collectionName: string;
  collectionOptions?: PongoDBCollectionOptions<Document, DocumentPayload>;
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
} & (
  | {
      getDocumentId: (event: ReadEvent<EventType>) => string | null;
      getDocumentIds?: never;
    }
  | {
      getDocumentId?: never;
      getDocumentIds: (event: ReadEvent<EventType>) => string[];
    }
  | {
      getDocumentId?: never;
      getDocumentIds?: never;
    }
) &
  (
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
  ) &
  JSONSerializationOptions;

export const pongoSingleStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
  EventPayloadType extends Event = EventType,
>({
  getDocumentId,
  getDocumentIds,
  ...options
}: PongoSingleStreamProjectionOptions<
  Document,
  EventType,
  EventMetaDataType,
  EventPayloadType
>): SQLiteProjectionDefinition<EventType, EventPayloadType> => {
  return pongoMultiStreamProjection<
    Document,
    EventType,
    EventMetaDataType,
    EventPayloadType
  >({
    kind: 'emt:projections:postgresql:pongo:single_stream',
    ...options,
    ...(getDocumentId
      ? { getDocumentId: getDocumentId }
      : getDocumentIds
        ? { getDocumentIds: getDocumentIds }
        : { getDocumentId: (event) => event.metadata.streamName }),
  });
};
