import {
  type CanHandle,
  type Event,
  type ReadEvent,
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
} from './';

export type PongoProjectionHandlerContext =
  PostgreSQLProjectionHandlerContext & {
    pongo: PongoClient;
  };

export type PongoDocumentEvolve<
  Document extends PongoDocument,
  EventType extends Event,
> =
  | ((
      document: Document | null,
      event: ReadEvent<EventType>,
    ) => Document | null)
  | ((
      document: Document | null,
      event: ReadEvent<EventType>,
    ) => Promise<Document | null>);

export type PongoProjectionOptions<EventType extends Event> = {
  handle: (
    events: ReadEvent<EventType>[],
    context: PongoProjectionHandlerContext,
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
};

export const pongoProjection = <EventType extends Event>({
  handle,
  canHandle,
}: PongoProjectionOptions<EventType>): PostgreSQLProjectionDefinition =>
  postgreSQLProjection<EventType>({
    canHandle,
    handle: async (events, context) => {
      const { connectionString, client } = context;
      const pongo = pongoClient(connectionString, { client });
      await handle(events, { ...context, pongo });
    },
  });

export type PongoMultiStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
> = {
  collectionName: string;
  getDocumentId: (event: ReadEvent<EventType>) => string;
  evolve: PongoDocumentEvolve<Document, EventType>;
  canHandle: CanHandle<EventType>;
};

export const pongoMultiStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
>({
  collectionName,
  getDocumentId,
  evolve,
  canHandle,
}: PongoMultiStreamProjectionOptions<
  Document,
  EventType
>): PostgreSQLProjectionDefinition =>
  pongoProjection({
    handle: async (events, { pongo }) => {
      const collection = pongo.db().collection<Document>(collectionName);

      for (const event of events) {
        await collection.handle(getDocumentId(event), async (document) => {
          return await evolve(document, event);
        });
      }
    },
    canHandle,
  });

export type PongoSingleStreamProjectionOptions<
  Document extends PongoDocument,
  EventType extends Event,
> = {
  collectionName: string;
  evolve: PongoDocumentEvolve<Document, EventType>;
  canHandle: CanHandle<EventType>;
};

export const pongoSingleStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
>({
  collectionName,
  evolve,
  canHandle,
}: PongoSingleStreamProjectionOptions<
  Document,
  EventType
>): PostgreSQLProjectionDefinition =>
  pongoMultiStreamProjection({
    collectionName,
    getDocumentId: (event) => event.metadata.streamName,
    evolve,
    canHandle,
  });
