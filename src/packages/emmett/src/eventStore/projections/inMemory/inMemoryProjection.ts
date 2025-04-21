import type { CanHandle, Event, ReadEvent } from '../../../typing';
import type {
  ProjectionDefinition,
  TruncateProjection,
} from '../../../projections';
import {
  getInMemoryDatabase,
  type Database,
} from '../../../database/inMemoryDatabase';
import {
  type InMemoryReadEventMetadata,
  type InMemoryProjectionHandlerContext,
} from '../../inMemoryEventStore';

export type InMemoryProjectionDefinition<EventType extends Event> =
  ProjectionDefinition<
    EventType,
    InMemoryReadEventMetadata,
    InMemoryProjectionHandlerContext
  >;

export type InMemoryProjectionHandlerOptions<EventType extends Event = Event> =
  {
    projections: InMemoryProjectionDefinition<EventType>[];
    events: ReadEvent<EventType, InMemoryReadEventMetadata>[];
    database: Database;
    eventStore: InMemoryProjectionHandlerContext['eventStore'];
  };

/**
 * Handles projections for the InMemoryEventStore
 * Similar to the PostgreSQL implementation, this processes events through projections
 */
export const handleInMemoryProjections = async <
  EventType extends Event = Event,
>(
  options: InMemoryProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const { projections, events, database, eventStore } = options;

  // Get all event types from the events batch to filter projections
  const eventTypes = events.map((e) => e.type);

  // Filter projections that can handle these event types
  const relevantProjections = projections.filter((p) =>
    p.canHandle.some((type) => eventTypes.includes(type)),
  );

  // Process each projection
  for (const projection of relevantProjections) {
    await projection.handle(events, {
      eventStore,
      database,
    });
  }
};

export type InMemoryDocumentEvolve<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> = (
  document: DocumentType | null,
  event: ReadEvent<EventType, InMemoryReadEventMetadata>,
) => DocumentType | null;

export type InMemoryProjectionOptions<EventType extends Event> = {
  handle: (
    events: ReadEvent<EventType, InMemoryReadEventMetadata>[],
    context: InMemoryProjectionHandlerContext & { database: Database },
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
  truncate?: TruncateProjection<
    InMemoryProjectionHandlerContext & { database: Database }
  >;
};

/**
 * Creates an InMemory projection
 */
export const inMemoryProjection = <EventType extends Event>({
  truncate,
  handle,
  canHandle,
}: InMemoryProjectionOptions<EventType>): InMemoryProjectionDefinition<EventType> => ({
  canHandle,
  handle: async (events, context) => {
    // Use the database from context if provided, otherwise create a new one
    const database = context.database || getInMemoryDatabase();
    await handle(events, {
      ...context,
      database,
    });
  },
  truncate: truncate
    ? (context) => {
        // Use the database from context if provided, otherwise create a new one
        const database = context.database || getInMemoryDatabase();
        return truncate({
          ...context,
          database,
        });
      }
    : undefined,
});

/**
 * Creates a multi-stream projection for InMemoryDatabase
 */
export type InMemoryMultiStreamProjectionOptions<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> = {
  canHandle: CanHandle<EventType>;
  collectionName: string;
  getDocumentId: (event: ReadEvent<EventType>) => string;
} & (
  | {
      evolve: InMemoryDocumentEvolve<DocumentType, EventType>;
    }
  | {
      evolve: InMemoryDocumentEvolve<DocumentType, EventType>;
      initialState: () => DocumentType;
    }
);

/**
 * Creates a projection that handles events across multiple streams
 */
export const inMemoryMultiStreamProjection = <
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
>(
  options: InMemoryMultiStreamProjectionOptions<DocumentType, EventType>,
): InMemoryProjectionDefinition<EventType> => {
  const { collectionName, getDocumentId, canHandle } = options;

  return inMemoryProjection({
    handle: async (
      events: ReadEvent<EventType, InMemoryReadEventMetadata>[],
      { database },
    ) => {
      const collection = database.collection<DocumentType>(collectionName);

      for (const event of events) {
        collection.handle(getDocumentId(event), (document) => {
          if ('initialState' in options) {
            return options.evolve(document ?? options.initialState(), event);
          } else {
            return options.evolve(document, event);
          }
        });
      }
    },
    canHandle,
    truncate: ({
      database,
    }: InMemoryProjectionHandlerContext & { database: Database }) => {
      return new Promise<void>((resolve) => {
        // For InMemory database, we can't directly truncate a collection
        // So we'll delete all documents from the collection
        const collection = database.collection<DocumentType>(collectionName);
        const documents = collection.find();

        for (const doc of documents) {
          if (doc && '_id' in doc) {
            const id = doc._id;
            collection.deleteOne((d) => d._id === id);
          }
        }

        resolve();
      });
    },
  });
};

/**
 * Creates a single-stream projection for InMemoryDatabase
 */
export type InMemorySingleStreamProjectionOptions<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> = {
  canHandle: CanHandle<EventType>;
  getDocumentId?: (event: ReadEvent<EventType>) => string;
  collectionName: string;
} & (
  | {
      evolve: InMemoryDocumentEvolve<DocumentType, EventType>;
    }
  | {
      evolve: InMemoryDocumentEvolve<DocumentType, EventType>;
      initialState: () => DocumentType;
    }
);

/**
 * Creates a projection that handles events from a single stream
 */
export const inMemorySingleStreamProjection = <
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
>(
  options: InMemorySingleStreamProjectionOptions<DocumentType, EventType>,
): InMemoryProjectionDefinition<EventType> => {
  return inMemoryMultiStreamProjection<DocumentType, EventType>({
    ...options,
    getDocumentId:
      options.getDocumentId ?? ((event) => event.metadata.streamName),
  });
};
