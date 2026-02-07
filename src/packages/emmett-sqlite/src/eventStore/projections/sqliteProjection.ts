import type { SQL } from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  projection,
  type CanHandle,
  type Event,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ProjectionInitOptions,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { SQLiteReadEventMetadata } from '../SQLiteEventStore';

export type SQLiteProjectionHandlerContext = {
  connection: AnySQLiteConnection;
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
  connection: AnySQLiteConnection;
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
  ) => Promise<SQL[]> | SQL[];
  canHandle: CanHandle<EventType>;
  initSQL?: SQL | SQL[];
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionHandlerContext>,
  ) => void | Promise<void>;
};

export const sqliteRawBatchSQLProjection = <EventType extends Event>(
  options: SQLiteRawBatchSQLProjection<EventType>,
): SQLiteProjectionDefinition<EventType> =>
  sqliteProjection<EventType>({
    canHandle: options.canHandle,
    handle: async (events, context) => {
      const sqls: SQL[] = await options.evolve(events, context);

      for (const sql of sqls) await context.connection.execute.command(sql);
    },
    init: async (initOptions) => {
      if (options.init) {
        await options.init(initOptions);
      }
      if (options.initSQL) {
        const initSQLs = Array.isArray(options.initSQL)
          ? options.initSQL
          : [options.initSQL];

        for (const sql of initSQLs)
          await initOptions.context.connection.execute.command(sql);
      }
    },
  });

export type SQLiteRawSQLProjection<EventType extends Event> = {
  evolve: (
    events: EventType,
    context: SQLiteProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[] | Promise<SQL> | SQL;
  canHandle: CanHandle<EventType>;
  initSQL?: SQL | SQL[];
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionHandlerContext>,
  ) => void | Promise<void>;
};

export const sqliteRawSQLProjection = <EventType extends Event>(
  options: SQLiteRawSQLProjection<EventType>,
): SQLiteProjectionDefinition<EventType> => {
  const { evolve, ...rest } = options;
  return sqliteRawBatchSQLProjection<EventType>({
    ...rest,
    evolve: async (events, context) => {
      const sqls: SQL[] = [];

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
