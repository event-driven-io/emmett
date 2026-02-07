import type { InMemoryDatabase } from '../../../database/inMemoryDatabase';
import type {
  ProjectionDefinition,
  TruncateProjection,
} from '../../../projections';
import type { CanHandle, Event, ReadEvent } from '../../../typing';
import type {
  InMemoryProjectionHandlerContext,
  InMemoryReadEventMetadata,
} from '../../inMemoryEventStore';

export const DATABASE_REQUIRED_ERROR_MESSAGE =
  'Database is required in context for InMemory projections';

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
    database: InMemoryDatabase;
    eventStore?: InMemoryProjectionHandlerContext['eventStore'];
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

export type InMemoryWithNotNullDocumentEvolve<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> = (
  document: DocumentType,
  event: ReadEvent<EventType, InMemoryReadEventMetadata>,
) => DocumentType | null;

export type InMemoryWithNullableDocumentEvolve<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> = (
  document: DocumentType | null,
  event: ReadEvent<EventType, InMemoryReadEventMetadata>,
) => DocumentType | null;

export type InMemoryDocumentEvolve<
  DocumentType extends Record<string, unknown>,
  EventType extends Event,
> =
  | InMemoryWithNotNullDocumentEvolve<DocumentType, EventType>
  | InMemoryWithNullableDocumentEvolve<DocumentType, EventType>;

export type InMemoryProjectionOptions<EventType extends Event> = {
  handle: (
    events: ReadEvent<EventType, InMemoryReadEventMetadata>[],
    context: InMemoryProjectionHandlerContext & { database: InMemoryDatabase },
  ) => Promise<void>;
  canHandle: CanHandle<EventType>;
  truncate?: TruncateProjection<
    InMemoryProjectionHandlerContext & { database: InMemoryDatabase }
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
    if (!context.database) {
      throw new Error(DATABASE_REQUIRED_ERROR_MESSAGE);
    }
    await handle(events, {
      ...context,
      database: context.database,
    });
  },
  truncate: truncate
    ? (context) => {
        if (!context.database) {
          throw new Error(DATABASE_REQUIRED_ERROR_MESSAGE);
        }
        return truncate({
          ...context,
          database: context.database,
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
      evolve: InMemoryWithNullableDocumentEvolve<DocumentType, EventType>;
    }
  | {
      evolve: InMemoryWithNotNullDocumentEvolve<DocumentType, EventType>;
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
        await collection.handle(getDocumentId(event), (document) => {
          if ('initialState' in options) {
            return options.evolve(document ?? options.initialState(), event);
          } else {
            return options.evolve(document, event);
          }
        });
      }
    },
    canHandle,
    truncate: async ({
      database,
    }: InMemoryProjectionHandlerContext & { database: InMemoryDatabase }) => {
      // For InMemory database, we can't directly truncate a collection
      // So we'll delete all documents from the collection
      const collection = database.collection<DocumentType>(collectionName);
      const documents = await collection.find();

      for (const doc of documents) {
        if (doc && '_id' in doc) {
          const id = doc._id;
          await collection.deleteOne((d) => d._id === id);
        }
      }
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
      evolve: InMemoryWithNullableDocumentEvolve<DocumentType, EventType>;
    }
  | {
      evolve: InMemoryWithNotNullDocumentEvolve<DocumentType, EventType>;
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
