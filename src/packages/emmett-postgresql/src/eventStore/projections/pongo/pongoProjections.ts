import {
  type CanHandle,
  type Event,
  type ReadEvent,
  type TruncateProjection,
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
import type { PostgresReadEventMetadata } from '../../postgreSQLEventStore';

export type PongoProjectionHandlerContext =
  PostgreSQLProjectionHandlerContext & {
    pongo: PongoClient;
  };

export type PongoWithNotNullDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
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
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
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
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
> =
  | PongoWithNotNullDocumentEvolve<Document, EventType, EventMetaDataType>
  | PongoWithNullableDocumentEvolve<Document, EventType, EventMetaDataType>;

export type PongoProjectionOptions<EventType extends Event> = {
  name: string;
  kind?: string;
  handle: (
    events: ReadEvent<EventType, PostgresReadEventMetadata>[],
    context: PongoProjectionHandlerContext,
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
  truncate?: TruncateProjection<PongoProjectionHandlerContext>;
  init?: (context: PongoProjectionHandlerContext) => void | Promise<void>;
};

export const pongoProjection = <EventType extends Event>({
  name,
  kind,
  truncate,
  handle,
  canHandle,
}: PongoProjectionOptions<EventType>): PostgreSQLProjectionDefinition<EventType> =>
  postgreSQLProjection<EventType>({
    name,
    kind: kind ?? 'emt:projections:postgresql:pongo:generic',
    canHandle,
    handle: async (events, context) => {
      const {
        connection: { connectionString, client, pool },
      } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client, pool },
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
          const {
            connection: { connectionString, client, pool },
          } = context;
          const pongo = pongoClient(connectionString, {
            connectionOptions: { client, pool },
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
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
> = {
  kind?: string;
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
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
>(
  options: PongoMultiStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition<EventType> => {
  const { collectionName, getDocumentId, canHandle } = options;

  return pongoProjection({
    name: collectionName,
    kind: options.kind ?? 'emt:projections:postgresql:pongo:multi_stream',
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
    truncate: async (context) => {
      const {
        connection: { connectionString, client, pool },
      } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client, pool },
      });

      try {
        await pongo.db().collection<Document>(collectionName).deleteMany();
      } finally {
        await pongo.close();
      }
    },
    init: async (context) => {
      const {
        connection: { connectionString, client, pool },
      } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client, pool },
      });

      try {
        await pongo.db().collection<Document>(collectionName).schema.migrate();
      } finally {
        await pongo.close();
      }
    },
  });
};

export type PongoSingleStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
> = {
  canHandle: CanHandle<EventType>;
  getDocumentId?: (event: ReadEvent<EventType>) => string;

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
  EventMetaDataType extends PostgresReadEventMetadata =
    PostgresReadEventMetadata,
>(
  options: PongoSingleStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition<EventType> => {
  return pongoMultiStreamProjection<Document, EventType, EventMetaDataType>({
    ...options,
    kind: 'emt:projections:postgresql:pongo:single_stream',
    getDocumentId:
      options.getDocumentId ?? ((event) => event.metadata.streamName),
  });
};
