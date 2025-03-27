import {
  projection,
  type CanHandle,
  type Event,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { SQLiteConnection } from '../../connection';
import type { SQLiteReadEventMetadata } from '../SQLiteEventStore';

export type SQLiteProjectionHandlerContext = {
  connection: SQLiteConnection;
};

export type SQLiteProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  SQLiteProjectionHandlerContext
>;

export type SQLiteProjectionDefinition<EventType extends Event = Event> =
  ProjectionDefinition<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext
  >;

export type SQLiteProjectionHandlerOptions<EventType extends Event = Event> = {
  events: ReadEvent<EventType, SQLiteReadEventMetadata>[];
  projections: SQLiteProjectionDefinition<EventType>[];
  connection: SQLiteConnection;
};

export const handleProjections = async <EventType extends Event = Event>(
  options: SQLiteProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const { projections: allProjections, events, connection } = options;

  const eventTypes = events.map((e) => e.type);

  for (const projection of allProjections) {
    if (!projection.canHandle.some((type) => eventTypes.includes(type))) {
      continue;
    }
    await projection.handle(events, {
      connection,
    });
  }
};

export const sqliteProjection = <EventType extends Event>(
  definition: SQLiteProjectionDefinition<EventType>,
): SQLiteProjectionDefinition<EventType> =>
  projection<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext
  >(definition);

export const sqliteRawBatchSQLProjection = <EventType extends Event>(
  handle: (
    events: EventType[],
    context: SQLiteProjectionHandlerContext,
  ) => Promise<string[]> | string[],
  ...canHandle: CanHandle<EventType>
): SQLiteProjectionDefinition<EventType> =>
  sqliteProjection<EventType>({
    canHandle,
    handle: async (events, context) => {
      const sqls: string[] = await handle(events, context);

      for (const sql of sqls) await context.connection.command(sql);
    },
  });

export const sqliteRawSQLProjection = <EventType extends Event>(
  getDocumentId: (event: EventType) => string,
  handle: (
    event: EventType,
    context: SQLiteProjectionHandlerContext,
    documentId: string,
  ) => Promise<string> | string,
  ...canHandle: CanHandle<EventType>
): SQLiteProjectionDefinition<EventType> =>
  sqliteRawBatchSQLProjection<EventType>(
    async (events, context) => {
      const sqls: string[] = [];

      for (const event of events) {
        sqls.push(await handle(event, context, getDocumentId(event)));
      }
      return sqls;
    },
    ...canHandle,
  );
