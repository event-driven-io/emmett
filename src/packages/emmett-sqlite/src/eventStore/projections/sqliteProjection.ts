import type {
  DatabaseDriverType,
  SQL,
  SQLExecutor,
} from '@event-driven-io/dumbo';
import type { AnySQLiteConnection } from '@event-driven-io/dumbo/sqlite';
import {
  projection,
  type CanHandle,
  type Event,
  type EventStoreReadSchemaOptions,
  type ProjectionDefinition,
  type ProjectionHandler,
  type ProjectionInitOptions,
  type ReadEvent,
} from '@event-driven-io/emmett';
import type { SQLiteReadEventMetadata } from '../SQLiteEventStore';

export type SQLiteProjectionHandlerContext = {
  execute: SQLExecutor;
  connection: AnySQLiteConnection;
  driverType: DatabaseDriverType;
};

export type SQLiteProjectionHandler<
  EventType extends Event = Event,
  EventMetaDataType extends SQLiteReadEventMetadata = SQLiteReadEventMetadata,
> = ProjectionHandler<
  EventType,
  EventMetaDataType,
  SQLiteProjectionHandlerContext
>;

export type SQLiteProjectionDefinition<
  EventType extends Event = Event,
  EventPayloadType extends Event = EventType,
> = ProjectionDefinition<
  EventType,
  SQLiteReadEventMetadata,
  SQLiteProjectionHandlerContext,
  EventPayloadType
>;

export type SQLiteProjectionHandlerOptions<EventType extends Event = Event> = {
  events: ReadEvent<EventType, SQLiteReadEventMetadata>[];
  projections: SQLiteProjectionDefinition<EventType>[];
} & SQLiteProjectionHandlerContext;

export const handleProjections = async <EventType extends Event = Event>(
  options: SQLiteProjectionHandlerOptions<EventType>,
): Promise<void> => {
  const {
    projections: allProjections,
    events,
    connection,
    execute,
    driverType,
  } = options;

  const eventTypes = events.map((e) => e.type);

  for (const projection of allProjections) {
    if (!projection.canHandle.some((type) => eventTypes.includes(type))) {
      continue;
    }
    await projection.handle(events, {
      connection,
      execute,
      driverType,
    });
  }
};

export const sqliteProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  definition: SQLiteProjectionDefinition<EventType, EventPayloadType>,
): SQLiteProjectionDefinition<EventType, EventPayloadType> =>
  projection<
    EventType,
    SQLiteReadEventMetadata,
    SQLiteProjectionHandlerContext,
    EventPayloadType
  >(definition);

export type SQLiteRawBatchSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType[],
    context: SQLiteProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[];
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionHandlerContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
};

export const sqliteRawBatchSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options: SQLiteRawBatchSQLProjection<EventType, EventPayloadType>,
): SQLiteProjectionDefinition<EventType, EventPayloadType> =>
  sqliteProjection<EventType, EventPayloadType>({
    name: options.name,
    kind: options.kind ?? 'emt:projections:sqlite:raw_sql:batch',
    version: options.version,
    canHandle: options.canHandle,
    eventsOptions: options.eventsOptions,
    handle: async (events, context) => {
      const sqls: SQL[] = await options.evolve(events, context);

      await context.execute.batchCommand(sqls);
    },
    init: async (initOptions) => {
      const initSQL = options.init
        ? await options.init(initOptions)
        : undefined;

      if (initSQL) {
        if (Array.isArray(initSQL)) {
          await initOptions.context.execute.batchCommand(initSQL);
        } else {
          await initOptions.context.execute.command(initSQL);
        }
      }
    },
  });

export type SQLiteRawSQLProjection<
  EventType extends Event,
  EventPayloadType extends Event = EventType,
> = {
  name: string;
  kind?: string;
  version?: number;
  evolve: (
    events: EventType,
    context: SQLiteProjectionHandlerContext,
  ) => Promise<SQL[]> | SQL[] | Promise<SQL> | SQL;
  canHandle: CanHandle<EventType>;
  init?: (
    context: ProjectionInitOptions<SQLiteProjectionHandlerContext>,
  ) => void | Promise<void> | SQL | Promise<SQL> | Promise<SQL[]> | SQL[];
  eventsOptions?: {
    schema?: EventStoreReadSchemaOptions<EventType, EventPayloadType>;
  };
};

export const sqliteRawSQLProjection = <
  EventType extends Event,
  EventPayloadType extends Event = EventType,
>(
  options: SQLiteRawSQLProjection<EventType, EventPayloadType>,
): SQLiteProjectionDefinition<EventType, EventPayloadType> => {
  const { evolve, kind, ...rest } = options;
  return sqliteRawBatchSQLProjection<EventType, EventPayloadType>({
    kind: kind ?? 'emt:projections:sqlite:raw:_sql:single',
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
