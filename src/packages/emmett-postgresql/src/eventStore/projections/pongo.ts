import {
  type Event,
  type EventTypeOf,
  type ReadEvent,
} from '@event-driven-io/emmett';
import {
  pongoClient,
  type PongoClient,
  type PongoDocument,
} from '@event-driven-io/pongo';
import pg from 'pg';
import { type ProjectionDefintion } from './';

export type PongoProjectionOptions<EventType extends Event> = {
  documentId: (event: ReadEvent<EventType>) => string;
  eventHandler: PongoProjectionHandler<EventType>;
  eventTypes: EventTypeOf<EventType>[];
};

export type PongoProjectionHandler<EventType extends Event = Event> = (
  documentId: (event: ReadEvent<EventType>) => string,
  connectionString: string,
  client: pg.PoolClient,
  events: ReadEvent<EventType>[],
) => Promise<void> | void;

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

export const pongoProjection = <EventType extends Event>(
  handle: (pongo: PongoClient, events: ReadEvent<EventType>[]) => Promise<void>,
  ...canHandle: EventTypeOf<EventType>[]
): ProjectionDefintion<EventType> => ({
  type: 'inline',
  canHandle,
  handle: async (
    connectionString: string,
    client: pg.PoolClient,
    events: ReadEvent<EventType>[],
  ) => {
    const pongo = pongoClient(connectionString, { client });
    await handle(pongo, events);
  },
});

export const pongoMultiStreamProjection = <
  Document extends PongoDocument,
  EventType extends Event,
>(
  collectionName: string,
  getDocumentId: (event: ReadEvent<EventType>) => string,
  evolve: PongoDocumentEvolve<Document, EventType>,
  ...canHandle: EventTypeOf<EventType>[]
): ProjectionDefintion<EventType> =>
  pongoProjection(
    async (pongo, events) => {
      const collection = pongo.db().collection<Document>(collectionName);

      for (const event of events) {
        await collection.handle(getDocumentId(event), async (document) => {
          return await evolve(document, event);
        });
      }
    },
    ...canHandle,
  );

export const pongoSingleProjection = <
  Document extends PongoDocument,
  EventType extends Event,
>(
  collectionName: string,
  evolve: PongoDocumentEvolve<Document, EventType>,
  ...canHandle: EventTypeOf<EventType>[]
): ProjectionDefintion<EventType> =>
  pongoMultiStreamProjection(
    collectionName,
    (event) => event.metadata.streamName,
    evolve,
    ...canHandle,
  );
