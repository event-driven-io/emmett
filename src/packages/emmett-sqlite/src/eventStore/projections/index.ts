import {
  projection,
  type AnyEvent,
  type CanHandle,
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
  EventType extends AnyEvent = AnyEvent,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  SQLiteProjectionHandlerContext
>;

export type SQLiteProjectionDefinition<EventType extends AnyEvent = AnyEvent> =
  ProjectionDefinition<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext
  >;

export type SQLiteProjectionHandlerOptions<
  EventType extends AnyEvent = AnyEvent,
> = {
  events: ReadEvent<EventType, SQLiteReadEventMetadata>[];
  projections: SQLiteProjectionDefinition<EventType>[];
  connection: SQLiteConnection;
};

export const handleProjections = async <EventType extends AnyEvent = AnyEvent>(
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

export const sqliteProjection = <EventType extends AnyEvent>(
  definition: SQLiteProjectionDefinition<EventType>,
): SQLiteProjectionDefinition<EventType> =>
  projection<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext
  >(definition);

export const sqliteRawBatchSQLProjection = <EventType extends AnyEvent>(
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

export const sqliteRawSQLProjection = <EventType extends AnyEvent>(
  handle: (
    event: EventType,
    context: SQLiteProjectionHandlerContext,
  ) => Promise<string> | string,
  ...canHandle: CanHandle<EventType>
): SQLiteProjectionDefinition<EventType> =>
  sqliteRawBatchSQLProjection<EventType>(
    async (events, context) => {
      const sqls: string[] = [];

      for (const event of events) {
        sqls.push(await handle(event, context));
      }
      return sqls;
    },
    ...canHandle,
  );
