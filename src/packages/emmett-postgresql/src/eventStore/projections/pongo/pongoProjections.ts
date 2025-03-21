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
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
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
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
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
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
> =
  | PongoWithNotNullDocumentEvolve<Document, EventType, EventMetaDataType>
  | PongoWithNullableDocumentEvolve<Document, EventType, EventMetaDataType>;

export type PongoProjectionOptions<EventType extends Event> = {
  handle: (
    events: ReadEvent<EventType, PostgresReadEventMetadata>[],
    context: PongoProjectionHandlerContext,
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
  truncate?: TruncateProjection<PongoProjectionHandlerContext>;
};

export const pongoProjection = <EventType extends Event>({
  truncate,
  handle,
  canHandle,
}: PongoProjectionOptions<EventType>): PostgreSQLProjectionDefinition<EventType> =>
  postgreSQLProjection<EventType>({
    canHandle,
    handle: async (events, context) => {
      const {
        connection: { connectionString, client, pool },
      } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client, pool },
      });
      await handle(events, {
        ...context,
        pongo,
      });
    },
    truncate: truncate
      ? (context) => {
          const {
            connection: { connectionString, client, pool },
          } = context;
          const pongo = pongoClient(connectionString, {
            connectionOptions: { client, pool },
          });
          return truncate({
            ...context,
            pongo,
          });
        }
      : undefined,
  });

export type PongoMultiStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
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
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
>(
  options: PongoMultiStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition<EventType> => {
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
    truncate: async (context) => {
      const {
        connection: { connectionString, client, pool },
      } = context;
      const pongo = pongoClient(connectionString, {
        connectionOptions: { client, pool },
      });

      await pongo.db().collection<Document>(collectionName).deleteMany();
    },
  });
};

export type PongoSingleStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
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
  EventMetaDataType extends
    PostgresReadEventMetadata = PostgresReadEventMetadata,
>(
  options: PongoSingleStreamProjectionOptions<
    Document,
    EventType,
    EventMetaDataType
  >,
): PostgreSQLProjectionDefinition<EventType> => {
  return pongoMultiStreamProjection<Document, EventType, EventMetaDataType>({
    ...options,
    getDocumentId:
      options.getDocumentId ?? ((event) => event.metadata.streamName),
  });
};
