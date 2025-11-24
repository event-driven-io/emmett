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

export type SQLiteRawBatchSQLProjection<EventType extends Event> = {
  evolve: (
    events: EventType[],
    context: SQLiteProjectionHandlerContext,
  ) => Promise<string[]> | string[];
  canHandle: CanHandle<EventType>;
  initSQL?: string | string[];
  init?: (context: SQLiteProjectionHandlerContext) => void | Promise<void>;
};

export const sqliteRawBatchSQLProjection = <EventType extends Event>(
  options: SQLiteRawBatchSQLProjection<EventType>,
): SQLiteProjectionDefinition<EventType> =>
  sqliteProjection<EventType>({
    canHandle: options.canHandle,
    handle: async (events, context) => {
      const sqls: string[] = await options.evolve(events, context);

      for (const sql of sqls) await context.connection.command(sql);
    },
    init: async (context) => {
      if (options.init) {
        await options.init(context);
      }
      if (options.initSQL) {
        const initSQLs = Array.isArray(options.initSQL)
          ? options.initSQL
          : [options.initSQL];

        for (const sql of initSQLs) await context.connection.command(sql);
      }
    },
  });

export type SQLiteRawSQLProjection<EventType extends Event> = {
  evolve: (
    events: EventType,
    context: SQLiteProjectionHandlerContext,
  ) => Promise<string[]> | string[] | Promise<string> | string;
  canHandle: CanHandle<EventType>;
  initSQL?: string | string[];
  init?: (context: SQLiteProjectionHandlerContext) => void | Promise<void>;
};

export const sqliteRawSQLProjection = <EventType extends Event>(
  options: SQLiteRawSQLProjection<EventType>,
): SQLiteProjectionDefinition<EventType> => {
  const { evolve, ...rest } = options;
  return sqliteRawBatchSQLProjection<EventType>({
    ...rest,
    evolve: async (events, context) => {
      const sqls: string[] = [];

      for (const event of events) {
        const pendingSqls = await evolve(event, context);
        if (Array.isArray(pendingSqls)) {
          sqls.push(...pendingSqls);
        } else {
          sqls.push(pendingSqls);
        }
      }
      return sqls;
    },
  });
};
